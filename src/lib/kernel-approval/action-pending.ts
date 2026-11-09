/**
 * 按**动作**取等人点头的 run —— 给有专属审批入口的动作用
 * （见 `kernel/dedicated-approval-entries.ts`）。只读。
 *
 * 🔴 为什么专属入口必须从这里读，而不是读它自己的账表：
 *    通用 handoff 对这些动作的等批准**不再发待办**。账表漏记一条（提交成功、
 *    写账失败，再重放走幂等命中不补写）的话，那条 run 就从所有待办里消失了。
 *    `action_runs` 才是真相；账表只能拿来补展示字段。
 *
 * 🔴 客户页面用 `…ForClient`，**必须**带 clientId，过滤钉在数据库侧。
 *    全客户版只给内部待办汇总用，单独一个函数 —— 不做「clientId 可选」，
 *    免得哪天漏传一个参数就把所有客户的待批准吐给一个客户。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ActionRun } from '@/lib/kernel/types'
import { TABLE_RUNS } from '@/lib/kernel/store'
import { RUN_COLUMNS, getDecisionsByIds } from './queries'
import { translateQueryError } from './errors'
import { decisionBelongsToRun } from './service'

export interface PendingRunForAction {
  readonly run: ActionRun
  /**
   * 此刻挂在这条 run 上、而且**确属**这条 run 的那份审批请求 id
   * （七条身份判据跟 SQL 对齐，见 `decisionBelongsToRun`）。
   * 读不到 / 对不上 = null：这条坏了，谁都不能批，界面和待办必须如实说。
   */
  readonly expectedDecisionId: string | null
}

export interface PendingRunsForAction {
  readonly items: PendingRunForAction[]
  /** 🔴 截断绝不许是静默的：超过 limit 时为 true。 */
  readonly hasMore: boolean
}

export const ACTION_PENDING_DEFAULT_LIMIT = 100

export function listPendingRunsForActionForClient(
  sb: SupabaseClient,
  actionKey: string,
  clientId: string,
  limit: number = ACTION_PENDING_DEFAULT_LIMIT,
): Promise<PendingRunsForAction> {
  return listPendingRunsForAction(sb, actionKey, clientId, limit)
}

export function listPendingRunsForActionAllClients(
  sb: SupabaseClient,
  actionKey: string,
  limit: number = ACTION_PENDING_DEFAULT_LIMIT,
): Promise<PendingRunsForAction> {
  return listPendingRunsForAction(sb, actionKey, null, limit)
}

async function listPendingRunsForAction(
  sb: SupabaseClient,
  actionKey: string,
  clientId: string | null,
  limit: number,
): Promise<PendingRunsForAction> {
  let query = sb.from(TABLE_RUNS).select(RUN_COLUMNS).eq('action_key', actionKey).eq('status', 'pending_approval')
  if (clientId !== null) query = query.eq('client_id', clientId)
  // 🔴 新的在前：截断时丢的是最老的，不是今天刚出的那条
  const { data, error } = await query
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1)
  if (error) translateQueryError('读取等待审批的动作', error)

  // 列清单是拼出来的字符串，supabase-js 推不出行形状（实测 tsc 报 GenericStringError[]）；
  // 行形状就是 RUN_COLUMNS，跟同目录 `getRunForApproval` 读的是同一组列、同一种转换。
  const rows = (data ?? []) as unknown as ActionRun[]
  const runs = rows.slice(0, limit)
  const decisions = await getDecisionsByIds(
    sb,
    runs.map((r) => r.authorization_decision_id).filter((id): id is string => typeof id === 'string' && id.length > 0),
  )
  const items = runs.map((run) => {
    const decision = run.authorization_decision_id ? decisions.get(run.authorization_decision_id) : undefined
    return { run, expectedDecisionId: decision && decisionBelongsToRun(decision, run) ? decision.id : null }
  })
  return { items, hasMore: rows.length > limit }
}
