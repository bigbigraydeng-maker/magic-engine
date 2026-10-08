/**
 * Inngest `onFailure` hook for the function that runs `runFactoryReelAdDraft`.
 *
 * The run function is written to never throw, so this hook only fires on an
 * unexpected platform-level failure (timeout, OOM, a bug in the runtime, etc.).
 *
 * Rule: a failure must leave a machine-readable receipt and must never be
 * silent. If the failure happened AFTER the intent row was created (status
 * `started`), we finish that row as `failed`. If no `started` intent exists we
 * write an `unhandled_failure` receipt row so the failure becomes a to-do
 * instead of living in a log. 若已存在终态意图行（如 drafted / draft_blocked），
 * 收据的 provider_impact 记为 unknown 并提示核对 Meta，避免误报“无对象”。
 *
 * We never throw: an `onFailure` hook that throws is itself a silent failure.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { FactoryReelPublishedEventSchema } from '@/lib/factory/publish/reel-published-event'
import {
  FACTORY_REEL_DRAFT_ACTION,
  buildIntentKey,
  finishIntent,
  type IntentMode,
  type IntentPayload,
} from './intent-ledger'

export type FailureReceiptResult =
  | { ok: true; finished: number; inserted: number }
  | {
      ok: false
      reason: 'invalid_event' | 'read_error' | 'write_error'
      message: string
    }

/** 意图行里我们回读需要的字段。 */
interface IntentRow {
  id: string
  payload: IntentPayload | null
}

const MODES: readonly IntentMode[] = ['dry_run', 'on']

/** 错误文本上限，避免把整段堆栈塞进 payload。 */
const MAX_ERROR_LEN = 300

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  try {
    const json = JSON.stringify(error)
    if (json !== undefined) return json
  } catch {
    // fall through to String(error)
  }
  return String(error)
}

function errorMessage(error: unknown): string {
  const raw = describeError(error)
  return raw.length > MAX_ERROR_LEN ? raw.slice(0, MAX_ERROR_LEN) : raw
}

/**
 * 记录一次未处理的函数级失败。
 *
 * 对 dry_run 与 on 两个 mode 分别回读意图行；凡是 `started` 的行都推进到
 * `failed`。没有任何 `started` 行时写入一行 `unhandled_failure` 收据，让这次
 * 失败变成一条待办，而不是只留在日志里。
 */
export async function recordUnhandledFailure(
  supabase: SupabaseClient,
  eventData: unknown,
  error: unknown,
  nowIso: string,
): Promise<FailureReceiptResult> {
  try {
    const parsed = FactoryReelPublishedEventSchema.safeParse(eventData)
    if (!parsed.success) {
      return { ok: false, reason: 'invalid_event', message: 'event data failed schema validation' }
    }
    const event = parsed.data

    const message = errorMessage(error)
    const patchError = `函数异常：${message}`

    let finished = 0
    let sawFinishedRow = false

    for (const mode of MODES) {
      const key = buildIntentKey(event.work_order_id, event.video_id, mode)

      const { data, error: readError } = await supabase
        .from('flywheel_actions')
        .select('id, payload')
        .eq('client_id', event.client_id)
        .eq('action_type', FACTORY_REEL_DRAFT_ACTION)
        .eq('payload->>idempotency_key', key)
        .maybeSingle()

      if (readError) {
        return { ok: false, reason: 'read_error', message: readError.message }
      }
      if (!data) continue

      const row = data as IntentRow
      if (row.payload?.status !== 'started') {
        sawFinishedRow = true
        continue
      }

      const res = await finishIntent(
        supabase,
        row.id,
        'failed',
        { error: patchError, provider_impact: 'unknown' },
        nowIso,
      )
      if (!res.ok) {
        return { ok: false, reason: 'write_error', message: res.error }
      }
      finished += 1
    }

    if (finished === 0) {
      const providerImpact = sawFinishedRow ? 'unknown' : 'none'
      const receiptError = sawFinishedRow
        ? `${patchError}；意图行已是终态，Meta 上可能已有对象，请核对`
        : patchError

      const receipt: IntentPayload = {
        idempotency_key: `factory-reel-ad:unhandled:${event.request_id}`,
        request_id: event.request_id,
        client_id: event.client_id,
        work_order_id: event.work_order_id,
        video_id: event.video_id,
        page_id: event.page_id,
        mode: 'on',
        status: 'failed',
        no_publish: true,
        authorization: 'pm_approval_required',
        provider_impact: providerImpact,
        created_at: nowIso,
        updated_at: nowIso,
        block_code: 'unhandled_failure',
        error: receiptError,
      }

      const { error: insertError } = await supabase
        .from('flywheel_actions')
        .insert({
          client_id: event.client_id,
          flywheel: 'ads',
          action_type: FACTORY_REEL_DRAFT_ACTION,
          execution_mode: 'third_party',
          vendor: 'meta',
          payload: receipt,
        })
        .select('id')
        .single()

      if (insertError) {
        if (insertError.code === '23505') {
          return { ok: true, finished: 0, inserted: 0 }
        }
        return { ok: false, reason: 'write_error', message: insertError.message }
      }

      return { ok: true, finished: 0, inserted: 1 }
    }

    return { ok: true, finished, inserted: 0 }
  } catch (err) {
    return { ok: false, reason: 'read_error', message: errorMessage(err) }
  }
}
