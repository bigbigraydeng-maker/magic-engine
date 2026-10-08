/**
 * Inngest `onFailure` hook for the function that runs `runFactoryReelAdDraft`.
 *
 * The run function is written to never throw, so this hook only fires on an
 * unexpected platform-level failure (timeout, OOM, a bug in the runtime, etc.).
 *
 * Rule: a failure must leave a machine-readable receipt and must never be
 * silent. If the failure happened AFTER the intent row was created (status
 * `started`), we finish that row as `failed`. If no `started` intent exists we
 * cannot invent one — we have no trustworthy ids — so we report that instead.
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
  | { ok: true; finished: number }
  | {
      ok: false
      reason: 'invalid_event' | 'read_error' | 'no_started_intent' | 'write_error'
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

function errorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  return raw.length > MAX_ERROR_LEN ? raw.slice(0, MAX_ERROR_LEN) : raw
}

/**
 * 记录一次未处理的函数级失败。
 *
 * 对 dry_run 与 on 两个 mode 分别回读意图行；凡是 `started` 的行都推进到
 * `failed`。没有任何 `started` 行时返回 `no_started_intent`——我们不会凭空
 * 造一行，因为那需要可信的 id，而失败路径上我们未必拿得到。
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
      if (row.payload?.status !== 'started') continue

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
      return {
        ok: false,
        reason: 'no_started_intent',
        message: 'no started intent found for this event',
      }
    }

    return { ok: true, finished }
  } catch (err) {
    return { ok: false, reason: 'read_error', message: errorMessage(err) }
  }
}
