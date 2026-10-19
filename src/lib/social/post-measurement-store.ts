/**
 * Act→Check 的落库层：发布动作行、快照 RPC、action 归属校验。
 *
 * ## 幂等全部压在数据库唯一约束上
 *
 * 「先查询、再插入」在并发下必漏 —— T+4 与 T+72 是两个独立 Inngest run，事件重放
 * 还可能让同一窗口同时跑两份。所以每处写入都是 insert → 撞 23505 → 回读/更新。
 * 三条约束见 `20260905000001_social_post_measurement_receipts.sql`。
 *
 * ## expected_metric 必须是 NULL
 *
 * 通用归因（`flywheel/attribution/job.ts`）按 `client_id + metric_key + 时间窗` 找
 * 基线与结果，**不看帖子身份**：同一客户两条帖子写同一个 `social.post.likes`，后一条
 * 的基线会捞到前一条的读数，delta 毫无意义。`loadAttributableActions` 只加载
 * `expected_metric IS NOT NULL` 的行，所以写 NULL = 通用归因根本不加载本动作，
 * 从结构上杜绝串帖。本期不接 Tune，单帖效果靠 action_id / idempotency_key 直查。
 *
 * ## P2 / P3 / P4 修正（Codex #1399 复审）
 *
 * - P2：幂等冲突时必须核对完整发布身份，不能只回读旧 id。
 * - P3：一次测量是不可分割的快照 —— 用 RPC 事务性提交回执 + 全部指标。
 * - P4：读 action 回来核对 client/post/page/idempotency，防跨客户串台。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { createHash } from 'node:crypto'

const UNIQUE_VIOLATION = '23505'
const SNAPSHOT_HASH_MISMATCH_HINT = 'snapshot_hash_mismatch'

export const SOCIAL_PUBLISH_ACTION_TYPE = 'social.publish_post'

export const POST_METRIC_KEYS = {
  likes: 'social.post.likes',
  comments: 'social.post.comments',
  shares: 'social.post.shares',
} as const

export type PostMetricField = keyof typeof POST_METRIC_KEYS
export type ReceiptStatus = 'ok' | 'partial' | 'unmeasurable'

export interface PublishActionInput {
  clientId: string
  idempotencyKey: string
  postId: string
  pageId: string
  permalink: string
  campaignId: string
  planId: string
  publishedAt: string
  scheduledPublishTime?: string
  measureAt: { hours: number; at: string }[]
}

/**
 * P2：同 idempotency_key 的重放不能只按 key 回读旧 id —— 必须核对所有不可变
 * 字段。任一不同就 fail-closed，不敢把新帖挂到旧 action。
 */
export function publishIdentityMismatch(
  existing: Record<string, unknown> | null,
  input: PublishActionInput,
): string | null {
  if (!existing) return 'action_not_readable'
  const p = (existing as { payload?: Record<string, unknown> }).payload ?? {}
  const check: [string, unknown, unknown][] = [
    ['client_id', (existing as { client_id?: unknown }).client_id, input.clientId],
    ['post_id', p.post_id, input.postId],
    ['page_id', p.page_id, input.pageId],
    ['idempotency_key', p.idempotency_key, input.idempotencyKey],
    ['campaign_id', p.campaign_id, input.campaignId],
    ['plan_id', p.plan_id, input.planId],
    ['published_at', p.published_at, input.publishedAt],
  ]
  for (const [name, a, b] of check) {
    if (a !== b) return `${name}_mismatch`
  }
  const scheduled = (p as { scheduled_publish_time?: unknown }).scheduled_publish_time
  if ((scheduled ?? null) !== (input.scheduledPublishTime ?? null)) {
    return 'scheduled_publish_time_mismatch'
  }
  // measure_at 是数组 —— 逐个比对 hours+at，不看顺序（但通常发布端稳定）。
  const existingMa = (p as { measure_at?: unknown }).measure_at
  if (!Array.isArray(existingMa)) return 'measure_at_missing'
  if (existingMa.length !== input.measureAt.length) return 'measure_at_length_mismatch'
  const norm = (xs: { hours: number; at: string }[]) =>
    JSON.stringify([...xs].sort((a, b) => a.hours - b.hours))
  if (
    norm(existingMa as { hours: number; at: string }[]) !==
    norm(input.measureAt)
  ) {
    return 'measure_at_mismatch'
  }
  return null
}

export class PublishActionIdentityMismatchError extends Error {
  constructor(public readonly field: string, public readonly existingActionId: string | null) {
    super(`recordPublishAction: identity mismatch on ${field}`)
    this.name = 'PublishActionIdentityMismatchError'
  }
}

/**
 * 记录「这条帖子已经发出去了」这个既成事实。隔离校验通过后立刻写，**此时不检查
 * token** —— 帖子已经在 Facebook 上，令牌能不能读表现是后面的事，不该抹掉发布事实。
 *
 * 不复用 `logSocialPublishedAction`：它（已随第三方发布通道退役删除）把 vendor 写死成第三方名、source 写死
 * `ai_factory`、还带 `expected_metric`，硬套会污染归因。
 */
export async function recordPublishAction(
  supabase: SupabaseClient,
  input: PublishActionInput,
): Promise<string> {
  const buildRow = () => ({
    client_id: input.clientId,
    flywheel: 'social',
    action_type: SOCIAL_PUBLISH_ACTION_TYPE,
    execution_mode: 'in_house',
    vendor: 'meta_graph',
    // 🔴 见文件头：NULL 让通用归因完全不加载本行，杜绝跨帖串台。
    expected_metric: null,
    expected_delta: null,
    // 公开时刻，不是提交时刻。排期帖两者可以差几天。
    executed_at: input.scheduledPublishTime ?? input.publishedAt,
    payload: {
      source: 'daily_plan',
      idempotency_key: input.idempotencyKey,
      post_id: input.postId,
      page_id: input.pageId,
      permalink: input.permalink,
      campaign_id: input.campaignId,
      plan_id: input.planId,
      published_at: input.publishedAt,
      ...(input.scheduledPublishTime ? { scheduled_publish_time: input.scheduledPublishTime } : {}),
      // 回执**不**写在这里 —— 两个窗口并发 read-modify-write 会互相覆盖。
      measure_at: input.measureAt,
    },
  })

  const { data, error } = await supabase.from('flywheel_actions').insert(buildRow()).select('id').single()

  if (!error && data) return (data as { id: string }).id

  if (error && (error as { code?: string }).code === UNIQUE_VIOLATION) {
    // 🔴 P2：并发或重放已经写过 —— 回读**完整**行核对身份。任一不同 fail-closed。
    const { data: existing, error: readError } = await supabase
      .from('flywheel_actions')
      .select('id, client_id, payload')
      .eq('client_id', input.clientId)
      .eq('action_type', SOCIAL_PUBLISH_ACTION_TYPE)
      .eq('payload->>idempotency_key', input.idempotencyKey)
      .maybeSingle()
    if (readError || !existing) {
      throw new Error(
        `recordPublishAction: unique conflict but row not readable — ${readError?.message ?? 'not found'}`,
      )
    }
    const mismatch = publishIdentityMismatch(
      existing as Record<string, unknown>,
      input,
    )
    if (mismatch) {
      throw new PublishActionIdentityMismatchError(
        mismatch,
        ((existing as { id?: string | null }).id ?? null) as string | null,
      )
    }
    return (existing as { id: string }).id
  }

  throw new Error(`recordPublishAction: ${error?.message ?? 'insert returned no row'}`)
}

/**
 * P4：读 action 回来，核对内部测量事件里带的身份字段与 action.payload 一致。
 * 消费测量事件时、访问 Meta 前必须过这一关。跨客户/换帖/换页事件由此挡下。
 */
export interface ActionIdentity {
  clientId: string
  idempotencyKey: string
  postId: string
  pageId: string
  windowHours: number
  targetAt: string
}

export type ActionIdentityCheck =
  | { ok: true }
  | { ok: false; reason: 'action_not_found' | 'client_mismatch' | 'post_mismatch' | 'page_mismatch' | 'idempotency_mismatch' | 'invalid_publish_action' | 'measurement_window_mismatch' }

/** Fixed Check contract, not a configurable polling or billable task policy. */
export function hasFixedMeasurementWindows(payload: Record<string, unknown>, claim: ActionIdentity): boolean {
  const windows = payload.measure_at
  const anchor = payload.scheduled_publish_time ?? payload.published_at
  if (typeof anchor !== 'string' || !Number.isFinite(Date.parse(anchor))) return false
  if (!Array.isArray(windows) || windows.length !== 2) return false
  const valid = [4, 72].every(hours => windows.filter(w =>
    w && w.hours === hours && typeof w.at === 'string' &&
    Date.parse(w.at) === Date.parse(anchor) + hours * 3600_000,
  ).length === 1)
  return valid && windows.some(w => w.hours === claim.windowHours && Date.parse(w.at) === Date.parse(claim.targetAt))
}

export async function verifyActionIdentity(
  supabase: SupabaseClient,
  actionId: string,
  claim: ActionIdentity,
): Promise<ActionIdentityCheck> {
  const { data, error } = await supabase
    .from('flywheel_actions')
    .select('client_id, action_type, payload')
    .eq('id', actionId)
    .maybeSingle()

  if (error) throw new Error(`verifyActionIdentity: db error — ${error.message}`)
  if (!data) return { ok: false, reason: 'action_not_found' }

  const row = data as { client_id: string; action_type: string; payload: Record<string, unknown> | null }
  const p = row.payload ?? {}
  if (row.client_id !== claim.clientId) return { ok: false, reason: 'client_mismatch' }
  if (p.idempotency_key !== claim.idempotencyKey) return { ok: false, reason: 'idempotency_mismatch' }
  if (p.post_id !== claim.postId) return { ok: false, reason: 'post_mismatch' }
  if (p.page_id !== claim.pageId) return { ok: false, reason: 'page_mismatch' }
  if (row.action_type !== SOCIAL_PUBLISH_ACTION_TYPE ||
      !['daily_plan', 'factory_reel'].includes(String(p.source))) {
    return { ok: false, reason: 'invalid_publish_action' }
  }
  if (!hasFixedMeasurementWindows(p, claim)) return { ok: false, reason: 'measurement_window_mismatch' }
  return { ok: true }
}

/**
 * P3：把 (window_hours, values) 折成稳定 hash。第二次重跑时同数字 → 同 hash →
 * RPC 认为是幂等重放；数字变化 → 不同 hash → RPC 拒绝覆盖，报 check_violation。
 */
export function snapshotHash(windowHours: number, values: Record<string, number>): string {
  // 稳定顺序序列化，同数字必产同 hash。
  const keys = Object.keys(values).sort()
  const norm = keys.map((k) => [k, values[k]] as const)
  return createHash('sha256').update(JSON.stringify([windowHours, norm])).digest('hex')
}

export interface SnapshotInput {
  clientId: string
  actionId: string
  idempotencyKey: string
  postId: string
  pageId: string
  windowHours: number
  targetAt: string
  measuredAt: string | null
  status: ReceiptStatus
  values: Record<string, number>
  missing: Record<string, string>
  reason?: string | null
  graphCode?: number | null
  graphSubcode?: number | null
}

export type SnapshotOutcome = 'written' | 'kept_success' | 'hash_mismatch'

/**
 * P3：一次快照 → 一次 RPC。回执与所有指标在同一事务里落库；
 *  - ok/partial 快照存在时 unmeasurable 不覆盖（返回 `kept_success`）；
 *  - hash 不同的 ok/partial 一律拒绝（返回 `hash_mismatch`）；
 *  - 同 hash 重放是幂等的（指标不重复）。
 */
export async function recordSnapshot(
  supabase: SupabaseClient,
  input: SnapshotInput,
): Promise<SnapshotOutcome> {
  const hash = snapshotHash(input.windowHours, input.values)
  const { data, error } = await supabase.rpc('record_post_measurement_snapshot', {
    p_client_id: input.clientId,
    p_action_id: input.actionId,
    p_idempotency_key: input.idempotencyKey,
    p_post_id: input.postId,
    p_page_id: input.pageId,
    p_window_hours: input.windowHours,
    p_target_at: input.targetAt,
    p_measured_at: input.measuredAt,
    p_status: input.status,
    p_values: input.values,
    p_missing: input.missing,
    p_snapshot_hash: hash,
    p_reason: input.reason ?? null,
    p_graph_code: input.graphCode ?? null,
    p_graph_subcode: input.graphSubcode ?? null,
  })

  if (!error) {
    const rows = (data ?? []) as Array<{ receipt_id: string; outcome: string }>
    const outcome = rows[0]?.outcome
    if (outcome === 'written') return 'written'
    if (outcome === 'kept_success') return 'kept_success'
    throw new Error(`recordSnapshot: unexpected outcome ${outcome ?? 'null'}`)
  }

  // RPC 里 RAISE 的 hash mismatch —— message 里带 SNAPSHOT_HASH_MISMATCH。
  const message = (error as { message?: string }).message ?? ''
  if (message.includes(SNAPSHOT_HASH_MISMATCH_HINT)) return 'hash_mismatch'

  throw new Error(`recordSnapshot: ${message}`)
}
