/**
 * Factory Reel → 广告草稿「意图账本」(intent ledger)。
 *
 * 在**任何 Meta 写入之前**先落一行 `flywheel_actions` 意图行。它同时承担两个职责：
 *   1. 去重闸：同一 (work order, video, mode) 只允许一条意图，重放直接回读旧行。
 *   2. 机器可读回执：记录自动草稿流水线对这一个 (work order, video) 做了什么。
 *
 * 为什么先写意图行：Meta 侧一旦创建了对象（campaign / ad set / ad），如果本地没有
 * 对应的账本行，这个对象就是「孤儿」——没人知道它属于哪个工单、哪个视频、谁授权
 * 的。先落账本，再动 Meta，任何中途失败都留下可追溯的痕迹。
 *
 * 为什么 idempotency_key 里带 mode：dry_run 只演练、不落 Meta 对象；on 才真正创建。
 * 两者是**不同的副作用**，必须落成**不同的行**。否则一次 dry_run 会把后续真正的
 * on 运行挡在门外（回读到 dry_run 行，误判「已经做过」）。所以：
 *   - 同一 (work order, video) 的 dry_run 意图与 on 意图是两行，互不阻塞；
 *   - 在**同一个 mode 内**，第二次 claim 回读旧行，调用方不得重做。
 *
 * 为什么用「裸 insert + 回读」而不是 upsert/onConflict：唯一索引是**部分索引**
 *   flywheel_actions (client_id, action_type, (payload->>'idempotency_key'))
 *   WHERE action_type = 'ads.factory_reel_draft'
 * PostgREST 的 onConflict 无法表达部分索引的 WHERE 谓词，硬用会撞错索引或直接报错。
 * 所以走和 `registerReelPublishAction` 同一条路：先 insert，撞 23505 再回读核对身份。
 *
 * 为什么已完成的意图永不覆盖：意图行是回执。`started` 之后的任何状态都代表一次
 * 已经发生过的副作用（或一次明确的阻断）。覆盖它 = 抹掉历史，重放时无法判断
 * 「这件事到底做没做过」。所以 finishIntent 只允许 `started` → 终态，且带
 * `payload->>status = 'started'` 的乐观锁条件。
 */
import type { SupabaseClient } from '@supabase/supabase-js'

/** 意图行的 action_type。与部分唯一索引的 WHERE 谓词必须逐字一致。 */
export const FACTORY_REEL_DRAFT_ACTION = 'ads.factory_reel_draft' as const

/** 意图生命周期。`started` 是唯一可被 finishIntent 推进的状态。 */
export type IntentStatus =
  | 'started'
  | 'blocked'
  | 'dry_run_ok'
  | 'drafted'
  | 'draft_blocked'
  | 'failed'

/** 运行模式：dry_run 只演练不落 Meta 对象；on 才真正创建（且仍需 PM 授权）。 */
export type IntentMode = 'dry_run' | 'on'

export interface IntentPayload {
  idempotency_key: string
  request_id: string
  client_id: string
  work_order_id: string
  video_id: string
  page_id: string
  mode: IntentMode
  status: IntentStatus
  /** 我们从不自己发布任何东西。 */
  no_publish: true
  /** 只有 PM 能把广告打开。 */
  authorization: 'pm_approval_required'
  provider_impact: 'none' | 'paused_objects_created' | 'unknown'
  created_at: string
  updated_at: string
  post_id?: string
  /** 这些对象被（或将被）创建在哪个 Meta 广告账户下，便于事后定位孤儿对象。 */
  ad_account_id?: string
  /** 这条被阻断的意图被重新认领过多少次。 */
  attempt?: number
  block_code?: string
  error?: string
  draft_action_id?: string
  campaign_id?: string
  ad_set_id?: string
  ad_ids?: string[]
  orphans?: string[]
  draft_preview?: Record<string, unknown>
}

/**
 * (work order, video, mode) → 稳定 idempotency_key。
 *
 * mode 参与 key：dry_run 与 on 是不同副作用，必须落成不同行，互不阻塞。
 */
export function buildIntentKey(
  workOrderId: string,
  videoId: string,
  mode: IntentMode,
): string {
  return `factory-reel-ad:${mode}:${workOrderId}:${videoId}`
}

export interface ClaimInput {
  requestId: string
  clientId: string
  workOrderId: string
  videoId: string
  pageId: string
  mode: IntentMode
  nowIso: string
}

export type ClaimResult =
  | { ok: true; created: true; actionId: string }
  | { ok: true; created: false; actionId: string; existing: IntentPayload }
  | {
      ok: false
      reason: 'db_error' | 'unique_conflict_unreadable' | 'identity_mismatch'
      field?: string
    }

const UNIQUE_VIOLATION = '23505'

/**
 * 认领一条意图行。首次调用创建 `started` 行；重放回读旧行并核对身份。
 *
 * 注意：`created: false` 时调用方拿到的是**已经存在**的意图——它可能已经完成
 * （drafted / failed / blocked）。调用方**不得**重做，只能按 existing.status 决策。
 *
 * 注意：去重范围是 (work order, video, mode)。同一 (work order, video) 的 dry_run
 * 意图与 on 意图是两行，互不阻塞。
 *
 * 例外：一条 `blocked` 且 `provider_impact === 'none'` 的意图——它从未碰过 Meta，
 * 重试是安全的——会被**重新认领**（原地推进回 `started`，attempt +1，清掉旧的
 * block_code / error）。除此之外的一切（failed / drafted / draft_blocked /
 * dry_run_ok / started，以及任何 provider_impact 非 none 的 blocked）永不重做。
 */
export async function claimIntent(
  supabase: SupabaseClient,
  input: ClaimInput,
): Promise<ClaimResult> {
  const idempotencyKey = buildIntentKey(input.workOrderId, input.videoId, input.mode)
  const payload: IntentPayload = {
    idempotency_key: idempotencyKey,
    request_id: input.requestId,
    client_id: input.clientId,
    work_order_id: input.workOrderId,
    video_id: input.videoId,
    page_id: input.pageId,
    mode: input.mode,
    status: 'started',
    no_publish: true,
    authorization: 'pm_approval_required',
    provider_impact: 'none',
    created_at: input.nowIso,
    updated_at: input.nowIso,
  }

  const row = {
    client_id: input.clientId,
    flywheel: 'ads',
    action_type: FACTORY_REEL_DRAFT_ACTION,
    execution_mode: 'third_party',
    vendor: 'meta',
    payload,
  }

  const { data, error } = await supabase.from('flywheel_actions').insert(row).select('id').single()
  if (!error && data) {
    return { ok: true, created: true, actionId: (data as { id: string }).id }
  }
  if (!error || (error as { code?: string }).code !== UNIQUE_VIOLATION) {
    return { ok: false, reason: 'db_error' }
  }

  const { data: existing, error: readError } = await supabase
    .from('flywheel_actions')
    .select('id, client_id, payload')
    .eq('client_id', input.clientId)
    .eq('action_type', FACTORY_REEL_DRAFT_ACTION)
    .eq('payload->>idempotency_key', idempotencyKey)
    .maybeSingle()
  if (readError || !existing) return { ok: false, reason: 'unique_conflict_unreadable' }

  const mismatch = intentIdentityMismatch(existing as Record<string, unknown>, input, idempotencyKey)
  if (mismatch) return { ok: false, reason: 'identity_mismatch', field: mismatch }

  const existingPayload = ((existing as { payload?: IntentPayload }).payload ?? null) as IntentPayload
  const existingId = (existing as { id: string }).id

  // 一条从未碰过 Meta 的 blocked 意图可以安全重试：原地推进回 started。
  if (existingPayload.status === 'blocked' && existingPayload.provider_impact === 'none') {
    const { block_code: _blockCode, error: _error, ...existingWithoutBlockFields } = existingPayload
    const next: IntentPayload = {
      ...existingWithoutBlockFields,
      request_id: input.requestId,
      status: 'started',
      attempt: (existingPayload.attempt ?? 1) + 1,
      updated_at: input.nowIso,
    }
    const { data: reclaimed, error: reclaimError } = await supabase
      .from('flywheel_actions')
      .update({ payload: next })
      .eq('id', existingId)
      .eq('payload->>status', 'blocked')
      .select('id')
    if (!reclaimError && Array.isArray(reclaimed) && reclaimed.length === 1) {
      return { ok: true, created: true, actionId: existingId }
    }
    // 更新失败或 0 行（别人抢先重新认领了）→ 退回普通重复结果。
  }

  return {
    ok: true,
    created: false,
    actionId: existingId,
    existing: existingPayload,
  }
}

/**
 * 回读同 idempotency_key 的旧行时全字段核对，防身份漂移串台。
 * 返回 null 表示一致；否则返回 `<name>_mismatch`。
 */
export function intentIdentityMismatch(
  existing: Record<string, unknown> | null,
  input: ClaimInput,
  idempotencyKey: string,
): string | null {
  if (!existing) return 'action_not_readable'
  const p = ((existing as { payload?: Record<string, unknown> }).payload ?? {}) as Record<string, unknown>
  const checks: [string, unknown, unknown][] = [
    ['client_id', (existing as { client_id?: unknown }).client_id, input.clientId],
    ['work_order_id', p.work_order_id, input.workOrderId],
    ['video_id', p.video_id, input.videoId],
    ['mode', p.mode, input.mode],
    ['page_id', p.page_id, input.pageId],
    ['idempotency_key', p.idempotency_key, idempotencyKey],
  ]
  for (const [name, a, b] of checks) if (a !== b) return `${name}_mismatch`
  return null
}

export type IntentPatch = Partial<
  Pick<
    IntentPayload,
    | 'post_id'
    | 'ad_account_id'
    | 'block_code'
    | 'error'
    | 'draft_action_id'
    | 'campaign_id'
    | 'ad_set_id'
    | 'ad_ids'
    | 'orphans'
    | 'provider_impact'
    | 'draft_preview'
  >
>

/**
 * 把一条 `started` 意图推进到终态。
 *
 * 只允许 `started` → 终态：已完成的意图永不覆盖（见文件头注释）。
 * 用 `.eq('payload->>status', 'started')` 做乐观锁，并发下只有一个赢家。
 */
export async function finishIntent(
  supabase: SupabaseClient,
  actionId: string,
  status: Exclude<IntentStatus, 'started'>,
  patch: IntentPatch,
  nowIso: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!actionId) return { ok: false, error: 'no action id' }

  const { data, error } = await supabase
    .from('flywheel_actions')
    .select('payload')
    .eq('id', actionId)
    .maybeSingle()
  if (error || !data) return { ok: false, error: 'intent row not readable' }

  const current = ((data as { payload?: IntentPayload }).payload ?? null) as IntentPayload | null
  if (!current) return { ok: false, error: 'intent payload missing' }
  if (current.status !== 'started') {
    return { ok: false, error: `intent already finished (status=${current.status})` }
  }

  const nextPayload: IntentPayload = {
    ...current,
    ...patch,
    status,
    updated_at: nowIso,
  }

  const { data: updated, error: updateError } = await supabase
    .from('flywheel_actions')
    .update({ payload: nextPayload })
    .eq('id', actionId)
    .eq('payload->>status', 'started')
    .select('id')
  if (updateError) return { ok: false, error: updateError.message }
  if (!Array.isArray(updated) || updated.length !== 1) {
    return { ok: false, error: 'intent update matched no rows' }
  }
  return { ok: true }
}
