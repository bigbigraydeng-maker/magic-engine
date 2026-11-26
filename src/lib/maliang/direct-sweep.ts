/**
 * 马良 review of admitted finished videos without Inngest (2026-11-23).
 *
 * Inngest's monthly quota ran out on 2026-11-15 (PM chose not to upgrade), so the
 * `me/maliang.render.ready` event sent at admit time is accepted but never runs.
 * This sweep picks admitted external uploads still in review with no verdict and runs
 * the same read → check → write steps in-process. Orders that already carry a
 * verdict are never picked by this sweep. (If Inngest later replays a backlog event,
 * that path does not check for an existing verdict and may review once more.)
 * Bounded per run: each review costs one model call. Unlike the Inngest path it
 * does not send material-only orders on to the dual review; a person clicks
 * 收入素材库, which runs that review inline. An order that cannot be read is
 * moved to the back of the queue; three failed reads in a row take it out.
 *
 * Switch: env INNGEST_DIRECT_FALLBACK = 'off' turns this off (shared with the other fallbacks).
 */

import type { WorkOrderReady } from './work-order-review'

export const MALIANG_DIRECT_JOB = 'maliang-direct-sweep'
// One review per run: a review may take up to 180 s and must finish before the next 20-minute knock.
export const MALIANG_DIRECT_BATCH = 1

export type DirectReviewOutcome =
  | { kind: 'checked'; status: string; reasons: string[] }
  | { kind: 'unread'; reason: string }

export interface MaliangSweepDeps {
  listPending(limit: number): Promise<WorkOrderReady[]>
  review(order: WorkOrderReady): Promise<DirectReviewOutcome>
  /** Move an unreadable order off the head of the queue. Optional in tests. */
  noteUnread?(order: WorkOrderReady, reason: string): Promise<void>
  /** Reviews per run; defaults to MALIANG_DIRECT_BATCH. */
  batch?: number
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

async function noteUnreadFailure(deps: MaliangSweepDeps, order: WorkOrderReady, reason: string): Promise<void> {
  if (!deps.noteUnread) return
  try {
    await deps.noteUnread(order, reason)
  } catch (err) {
    console.warn(`[maliang-direct-sweep] could not move ${order.work_order_id} back: ${errText(err)}`)
  }
}

export async function runMaliangDirectSweep(deps: MaliangSweepDeps): Promise<MaliangSweepReceipt> {
  if (running) return { status: 'busy', picked: 0, results: [], error: null }
  running = true
  try {
    let pending: WorkOrderReady[]
    try {
      const batch = deps.batch ?? MALIANG_DIRECT_BATCH
      pending = (await deps.listPending(batch)).slice(0, batch)
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
      if (outcome.kind === 'unread') await noteUnreadFailure(deps, order, outcome.reason)
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
