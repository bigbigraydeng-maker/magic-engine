/**
 * 审批层的读取 —— **只读**。这个文件里一句写入都没有。
 *
 * 🔴 三条硬规矩：
 *
 *    ① **「查不到」「表不存在」「查炸了」是三件事，返回值必须能分开。**
 *       返回 `[]` 表示真的没有等审批的动作；表不存在抛 `kernel_not_provisioned`；
 *       其余错误原样抛出去（500）。把后两者压成 `[]` 是这个仓库反复踩过的坑：
 *       界面显示「一切正常」，而实际上整套东西没启用 / 库在报错。
 *
 *    ② **列表查询的客户过滤钉死在数据库侧**，不在内存里挑。调用方给的
 *       `clientId` 在进来之前**必须**已经过真实的客户权限校验（见路由）。
 *
 *    ③ 详情 / 决定路径**不接受**调用方声称的 clientId —— 一律 `runId → getRun →
 *       run.client_id`，再拿那个 client_id 去鉴权。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ActionRun, AuthorizationDecision } from '@/lib/kernel/types'
import { TABLE_RUNS, TABLE_DECISIONS } from '@/lib/kernel/store'
import { isUuid } from '@/lib/validation-utils'
import { translateQueryError } from './errors'

/**
 * 🔴 只取审批界面真正要用的列。
 *    `SELECT *` 会把将来新加的列一起带出去 —— 审批接口是给人看的，
 *    多带出去的东西没人审过。
 */
const RUN_COLUMNS =
  'id, client_id, purpose, goal_id, action_key, action_version, input, rationale, evidence, ' +
  'status, authorization_decision_id, cost_cap_usd, cost_estimate_usd, updated_at, created_at'

/**
 * 🔴 `action_key` / `action_version` / `idempotency_key` **不是给界面看的** ——
 *    它们是**身份判据**：`decisionBelongsToRun()` 要拿它们跟 run 逐条比。
 *    读不回来就比不了，读路径就会比 SQL 写路径松一截（Codex P2）。
 *    列出来之后不许再删：删掉不会报错，只会让那三条判据静静地永远为真。
 */
export const DECISION_COLUMNS =
  'id, action_run_id, client_id, action_key, action_version, idempotency_key, ' +
  'verdict, reason, policy_id, policy_version, created_at'

/** 一页默认多少条。审批是人一条条看的，不做无上限列表。 */
export const PENDING_APPROVAL_PAGE_SIZE = 50
/** 一页最多多少条。再大就不是「给人看的一页」了。 */
export const PENDING_APPROVAL_MAX_PAGE_SIZE = 200

export interface PendingRunsPage {
  runs: ActionRun[]
  /** 🔴 后面还有没有。**截断绝不许是静默的。** */
  hasMore: boolean
  limit: number
  /**
   * 下一页的游标。`hasMore` 为假时是 null。
   * 不透明字符串 —— 调用方原样回传，不许自己拼。
   */
  nextCursor: string | null
}

/**
 * 游标 = 上一页最后一条的 `(updated_at, id)`。
 *
 * 🔴 **为什么不能用 offset。**（Codex P2）
 *    待审批是一条**活的**队列：翻页期间，第一页那几条可能正好被处理掉，
 *    于是它们退出 `pending_approval` 过滤集、结果集整体左移。
 *    这时 `offset=limit` 会从**缩短之后**的集合里再跳过 limit 行 ——
 *    紧接在第一页后面的那几条**一条都不会被返回**，而调用方毫不知情。
 *    稳定的排序键只能保证「同一份数据里顺序不变」，救不了这种位移。
 *
 *    keyset 游标是按**值**定位的：「给我排在 (t, id) 之后的那些」。
 *    前面的行被删掉多少都不影响这个判据 —— 位移根本不存在。
 */
function encodeCursor(run: ActionRun): string {
  return `${run.updated_at}|${run.id}`
}

function decodeCursor(raw: unknown): { updatedAt: string; id: string } | null {
  if (typeof raw !== 'string') return null
  const sep = raw.lastIndexOf('|')
  if (sep <= 0 || sep === raw.length - 1) return null
  const updatedAt = raw.slice(0, sep)
  const id = raw.slice(sep + 1)
  // 🔴 读不成就当**没给**，不是当成第一页的某个位置 —— 编一个位置出来会跳条。
  if (!isUuid(id)) return null
  if (Number.isNaN(Date.parse(updatedAt))) return null
  return { updatedAt, id }
}

export async function listPendingRunsForClient(
  sb: SupabaseClient,
  clientId: string,
  page: { limit?: number; cursor?: unknown } = {},
): Promise<PendingRunsPage> {
  const limit = clampPageSize(page.limit)
  const cursor = decodeCursor(page.cursor)

  let query = sb
    .from(TABLE_RUNS)
    .select(RUN_COLUMNS)
    .eq('client_id', clientId)
    .eq('status', 'pending_approval')

  if (cursor) {
    // 「严格排在 (updatedAt, id) 之后」—— 跟下面的排序键一一对应。
    // 🔴 第二段的 `and(...)` 不能省：`updated_at` 会撞（同一批一起挂起的 run
    //    时间戳一样），只比时间的话，撞在游标那一刻的同伴会被整批跳过。
    query = query.or(
      `updated_at.gt.${cursor.updatedAt},and(updated_at.eq.${cursor.updatedAt},id.gt.${cursor.id})`,
    )
  }

  // 多取一条 —— 拿回来的比 limit 多，就说明后面还有
  const { data, error } = await query
    .order('updated_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(limit + 1)

  if (error) translateQueryError('读取等待审批的动作', error)
  const rows = (data ?? []) as unknown as ActionRun[]
  const hasMore = rows.length > limit
  const runs = hasMore ? rows.slice(0, limit) : rows
  return {
    runs,
    hasMore,
    limit,
    nextCursor: hasMore && runs.length > 0 ? encodeCursor(runs[runs.length - 1]) : null,
  }
}

/** 页大小夹到 [1, MAX]；给的不是个正整数就用默认值（**不报错，也不当成无上限**）。 */
export function clampPageSize(requested: unknown): number {
  const n = typeof requested === 'number' ? requested : Number(requested)
  if (!Number.isFinite(n) || n < 1) return PENDING_APPROVAL_PAGE_SIZE
  return Math.min(Math.trunc(n), PENDING_APPROVAL_MAX_PAGE_SIZE)
}

/**
 * 按 runId 读一条 run。**不带任何 clientId 过滤** ——
 * 客户归属是从这一行**读出来**的，不是调用方说了算。
 */
export async function getRunForApproval(
  sb: SupabaseClient,
  runId: string,
): Promise<ActionRun | null> {
  const { data, error } = await sb.from(TABLE_RUNS).select(RUN_COLUMNS).eq('id', runId).limit(1)
  if (error) translateQueryError('读取这条动作', error)
  return ((data ?? [])[0] as unknown as ActionRun | undefined) ?? null
}

/** 读一条授权决策。查不到返回 null（那是真的没有），查炸了抛。 */
export async function getDecisionForApproval(
  sb: SupabaseClient,
  decisionId: string,
): Promise<AuthorizationDecision | null> {
  const { data, error } = await sb
    .from(TABLE_DECISIONS)
    .select(DECISION_COLUMNS)
    .eq('id', decisionId)
    .limit(1)
  if (error) translateQueryError('读取这份审批请求', error)
  return ((data ?? [])[0] as unknown as AuthorizationDecision | undefined) ?? null
}

/**
 * 一次把一批 run 对应的审批请求读回来（列表用，避免 N+1）。
 *
 * 🔴 读不到的那些**不补默认值**：调用方拿不到就照实说这条数据不完整，
 *    不能凭空造一份「审批请求」出来给人点。
 */
export async function getDecisionsByIds(
  sb: SupabaseClient,
  decisionIds: readonly string[],
): Promise<Map<string, AuthorizationDecision>> {
  if (decisionIds.length === 0) return new Map()
  const { data, error } = await sb
    .from(TABLE_DECISIONS)
    .select(DECISION_COLUMNS)
    .in('id', decisionIds as string[])
  if (error) translateQueryError('读取这批审批请求', error)
  const rows = (data ?? []) as unknown as AuthorizationDecision[]
  return new Map(rows.map((row) => [row.id, row]))
}
