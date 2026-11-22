/**
 * 马良 review of admitted finished videos without Inngest (2026-11-23).
 *
 * Inngest's monthly quota ran out on 2026-11-15 (PM chose not to upgrade), so the
 * `me/maliang.render.ready` event sent at admit time is accepted but never runs.
 * This sweep picks admitted external uploads still in review with no verdict and runs
 * the same read → check → write steps in-process. Orders that already carry a
 * verdict are never picked, so running beside Inngest after the quota resets does
 * not review twice. Bounded per run: each review costs one model call.
 *
 * Switch: env INNGEST_DIRECT_FALLBACK = 'off' turns this off (shared with the other fallbacks).
 */

import type { WorkOrderReady } from './work-order-review'

export const MALIANG_DIRECT_JOB = 'maliang-direct-sweep'
export const MALIANG_DIRECT_BATCH = 3

export type DirectReviewOutcome =
  | { kind: 'checked'; status: string; reasons: string[] }
  | { kind: 'unread'; reason: string }

export interface MaliangSweepDeps {
  listPending(limit: number): Promise<WorkOrderReady[]>
  review(order: WorkOrderReady): Promise<DirectReviewOutcome>
}

export interface MaliangSweepReceipt {
  status: 'done' | 'list_failed' | 'busy'
  picked: number
  results: Array<{ work_order_id: string; outcome: DirectReviewOutcome }>
  error: string | null
}

let running = false

function errText(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).slice(0, 300)
}

export async function runMaliangDirectSweep(deps: MaliangSweepDeps): Promise<MaliangSweepReceipt> {
  if (running) return { status: 'busy', picked: 0, results: [], error: null }
  running = true
  try {
    let pending: WorkOrderReady[]
    try {
      pending = (await deps.listPending(MALIANG_DIRECT_BATCH)).slice(0, MALIANG_DIRECT_BATCH)
    } catch (err) {
      return { status: 'list_failed', picked: 0, results: [], error: errText(err) }
    }
    const results: MaliangSweepReceipt['results'] = []
    // One after another: the check calls a paid model and the writes re-read the order.
    for (const order of pending) {
      let outcome: DirectReviewOutcome
      try {
        outcome = await deps.review(order)
      } catch (err) {
        outcome = { kind: 'unread', reason: errText(err) }
      }
      results.push({ work_order_id: order.work_order_id, outcome })
    }
    return { status: 'done', picked: pending.length, results, error: null }
  } finally {
    running = false
  }
}

/** Public URL the admit step sends to 马良 for an order's own file. */
export function contentFactoryPublicUrl(supabaseUrl: string, videoPath: string): string {
  return `${supabaseUrl.replace(/\/+$/, '')}/storage/v1/object/public/content-factory/${videoPath}`
}
