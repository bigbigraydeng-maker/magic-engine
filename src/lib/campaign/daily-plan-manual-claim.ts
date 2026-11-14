/**
 * Manual Facebook publish takes the same per-date claim the unattended publisher uses.
 *
 * Why: two writers (a person clicking "确认发布" and the sweep) used to be kept apart only by a
 * check-then-act read. Both now INSERT into the same `unique(plan_id, date)` row, so whoever inserts first
 * wins and the other is refused before any Facebook call.
 *
 * Pure helpers only; the row writes live in `daily-plan-auto-publish-worker-store.ts`.
 */
import type { AttemptPatch } from './daily-plan-auto-publish-worker-store'

/** What the claim step remembers about a date this request claimed. */
export interface ManualClaim {
  /** The date held a RECALLED tombstone that the manual publish took over; put it back unless the post went out. */
  restoreRecalled: boolean
}

interface ReceiptLike {
  published?: Array<{ date?: unknown; post_id?: unknown; scheduled_publish_time?: unknown }>
  failed?: Array<{ date?: unknown; certainty?: unknown }>
}

function asReceipt(value: unknown): ReceiptLike | null {
  return typeof value === 'object' && value !== null ? (value as ReceiptLike) : null
}

/**
 * The attempt row a claimed date should end as, read from the receipt the publish run produced.
 * Anything this cannot prove (no receipt, date in neither list, a failure of unknown certainty) is `unknown_outcome`:
 * Facebook may already hold the Post, and a person has to look.
 */
export function manualAttemptPatch(date: string, receiptValue: unknown, claim: ManualClaim): AttemptPatch {
  const receipt = asReceipt(receiptValue)
  // `failed[]` only holds this run's failures, `published[]` also holds earlier runs: where both name the date, this
  // run's failure is the answer for this run, and the newest published entry is the answer when there is no failure.
  const failed = receipt?.failed?.filter(item => item.date === date).pop()
  const published = receipt?.published?.filter(post => post.date === date).pop()

  if (failed && (failed.certainty === 'rejected' || failed.certainty === 'rate_limited')) {
    // Nothing went out. A recalled date goes back to being recalled so the sweep never republishes it.
    return claim.restoreRecalled
      ? { status: 'blocked', reason_code: 'RECALLED', next_retry_at: null }
      : { status: 'failed_final', reason_code: 'MANUAL_REJECTED', next_retry_at: null }
  }

  if (!failed && published && typeof published.post_id === 'string' && published.post_id.length > 0) {
    return {
      status: 'published',
      reason_code: 'MANUAL_PUBLISH',
      post_id: published.post_id,
      scheduled_publish_time: typeof published.scheduled_publish_time === 'string' ? published.scheduled_publish_time : null,
      provider_impact: 'FB_SCHEDULED',
      next_retry_at: null,
    }
  }

  return { status: 'unknown_outcome', reason_code: 'MANUAL_UNKNOWN', next_retry_at: null }
}
