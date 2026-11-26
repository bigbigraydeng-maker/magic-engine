// Reel scheduled go-public — the executor side. Design: docs/specs/2026-11-04-reel-scheduled-go-public-design-v0.2.md §8.2.
// A person approved this reel on the week card (scheduled-grant.ts); on its day this runs the same go-public
// pipeline as a person-confirmed promote, after re-running every gate. Not reachable from any web route.

import { buildContext, type PromoteContext } from './context'
import { executeClaimed } from './action'
import { computeFingerprint } from './guards'
import { mutatePayload, readAuth, withAuth } from './payload-lock'
import {
  FIRST_COMMENT_FAILED, checkGrant, claimedGrant, grantWithStatus, isLeaseExpired, nzToday, readGrant, withGrant,
  type ScheduledGrant, type ScheduledGrantStatus,
} from './scheduled-grant'
import { readPublishOn } from '@/lib/social/week-pack/manifest'
import { CLAIM_LEASE_MS, type PromoteDeps, type PromoteOrder, type TrafficRow } from './types'

export type ScheduledOutcome =
  | 'published' | 'synced' | 'dry_run_ok' | 'not_due'
  | 'consumed_manual' | 'stale' | 'missed' | 'unknown' | 'failed' | 'blocked_retry' | 'no_grant'

export interface ScheduledResult {
  order_id: string
  outcome: ScheduledOutcome
  reason: string
  /** true when a person must act (the to-do reader shows these). */
  needs_person: boolean
}

export interface ScheduledInput {
  orderId: string
  /** e.g. system:week-card:<run id>; recorded next to the approver, never replaces them. */
  executedBy: string
  isApprover: (email: string) => boolean
  dryRun: boolean
  /** Practice runs only: check as if today were this NZ date (YYYY-MM-DD). Ignored for real runs. */
  asOf?: string
}

const result = (order_id: string, outcome: ScheduledOutcome, reason: string, needs_person: boolean): ScheduledResult =>
  ({ order_id, outcome, reason, needs_person })

/** Content fingerprint without the catalog version: a catalog edit alone must not void an approval (the fact re-check still runs). */
export function grantFingerprint(ctx: PromoteContext): string {
  return computeFingerprint({ videoId: ctx.videoId, description: ctx.view.description, firstComment: ctx.firstComment, approvedAt: ctx.approvedAt })
}

async function setGrant(deps: PromoteDeps, row: TrafficRow, status: ScheduledGrantStatus, reason: string): Promise<void> {
  await mutatePayload(deps, row, (cur) => {
    const g = readGrant(cur)
    return g ? withGrant(cur, grantWithStatus(g, status, reason, deps.now())) : 'no_grant'
  }, 3)
}

/** Runs one approved reel on its day. Every failure leaves the reel unpublished and says why. */
export async function runScheduledPromote(deps: PromoteDeps, input: ScheduledInput): Promise<ScheduledResult> {
  const order = await deps.store.loadOrder(input.orderId)
  if (!order) return result(input.orderId, 'failed', 'order_missing', true)
  const rows = await deps.store.loadTrafficRows(order.id, order.client_id)
  if (rows.length !== 1) return result(order.id, 'failed', `traffic_rows_${rows.length}`, true)
  const row = rows[0]
  const grant = readGrant(rows[0].payload)
  const early = await settleWithoutClaim(deps, order, row, grant, input)
  if (early) return early
  return claimAndRun(deps, order, row, input)
}

/** Cases decided before touching the platform: no grant, manual go-public, an interrupted earlier attempt. */
async function settleWithoutClaim(
  deps: PromoteDeps, order: PromoteOrder, row: TrafficRow, grant: ScheduledGrant | null, input: ScheduledInput,
): Promise<ScheduledResult | null> {
  if (!grant) return result(order.id, 'no_grant', 'no_grant', false)
  if (grant.status === 'armed' && readAuth(row.payload).status === 'consumed') {
    if (!input.dryRun) await setGrant(deps, row, 'consumed_manual', 'promoted_by_a_person')
    return result(order.id, 'consumed_manual', 'promoted_by_a_person', false)
  }
  if (isLeaseExpired(grant, deps.now()) && !input.dryRun) {
    const finished = finishedBeforeInterrupt(order, row)
    if (finished) {
      // The earlier attempt got past going public and died before marking the grant: settle, never re-run.
      await setGrant(deps, row, finished, `${finished}_before_interrupt`)
      return result(order.id, finished === 'consumed' ? 'synced' : 'unknown', `${finished}_before_interrupt`, finished !== 'consumed')
    }
    // An earlier attempt died part-way. Re-arm and carry on: the run reads Facebook first, so a reel that did go
    // public is only synced (never published twice), and one that did not is promoted now.
    await setGrant(deps, row, 'armed', 'rearmed_after_interrupt')
  }
  return null
}

/** consumed = the go-public fully finished; unknown = the reel is public but its bookkeeping did not finish. */
function finishedBeforeInterrupt(order: PromoteOrder, row: TrafficRow): 'consumed' | 'unknown' | null {
  if (readAuth(row.payload).status === 'consumed') return 'consumed'
  const ref = order.published_ref
  return typeof ref === 'object' && ref !== null && ref['video_state'] === 'PUBLISHED' ? 'unknown' : null
}

async function claimAndRun(deps: PromoteDeps, order: PromoteOrder, row: TrafficRow, input: ScheduledInput): Promise<ScheduledResult> {
  const ctx = await buildContext(deps, order)
  if ('ok' in ctx) return contextFailed(deps, order, row, ctx.status, ctx.error, input.dryRun)
  const today = input.dryRun && input.asOf ? input.asOf : nzToday(deps.now())
  const publishOn = readPublishOn(order.brief)
  const current = {
    today,
    currentPublishOn: typeof publishOn === 'string' ? publishOn : null,
    // Already public on Facebook (a person did it there): only sync, the draft copy can legitimately differ.
    currentFingerprint: ctx.view.published ? (readGrant(row.payload)?.fingerprint ?? '') : grantFingerprint(ctx),
    isApprover: input.isApprover,
  }
  if (input.dryRun) {
    const chk = checkGrant({ grant: readGrant(row.payload), ...current })
    return chk.ok ? result(order.id, 'dry_run_ok', 'all_gates_pass', false) : result(order.id, 'not_due', chk.reason, false)
  }
  const requestId = deps.uuid()
  const claimed = await claimUnderGrant(deps, ctx, row, current, requestId, input.executedBy)
  if (claimed.kind !== 'claimed') return claimed.result
  const done = await executeClaimed(deps, ctx, claimed.payload, requestId)
  if (!done.ok) {
    // Facebook already called = it may be public now: say "unknown", never "still a draft".
    const called = ctx.view.published || (await platformWasCalled(deps, row))
    const status: ScheduledGrantStatus = called ? 'unknown' : 'failed'
    await setGrant(deps, row, status, done.error.slice(0, 200))
    return result(order.id, status, done.error.slice(0, 200), true)
  }
  // Public, but the first comment (the booking link) did not post: a person has to add it.
  const commentFailed = 'first_comment_status' in done.data && done.data.first_comment_status === 'failed'
  await setGrant(deps, row, 'consumed', commentFailed ? FIRST_COMMENT_FAILED : done.kind)
  return result(order.id, done.kind === 'synced' ? 'synced' : 'published', commentFailed ? FIRST_COMMENT_FAILED : done.kind, commentFailed)
}

async function platformWasCalled(deps: PromoteDeps, row: TrafficRow): Promise<boolean> {
  const fresh = await deps.store.loadTrafficRow(row.id, row.client_id).catch(() => null)
  // Cannot tell = assume it was called (report "unknown", the safe side). A clean Facebook refusal clears
  // promote_called_at; a public video whose bookkeeping failed is left as meta_published_db_pending.
  if (fresh === null) return true
  const auth = readAuth(fresh.payload)
  return typeof auth.promote_called_at === 'string' || typeof auth.published_at === 'string'
    || auth.status === 'meta_published_db_pending' || fresh.payload['video_state'] === 'PUBLISHED'
}

/** A gate failed before claiming. Unreadable catalog = try again at the next wake-up; anything else needs a person. */
async function contextFailed(
  deps: PromoteDeps, order: PromoteOrder, row: TrafficRow, status: number, error: string, dryRun: boolean,
): Promise<ScheduledResult> {
  // Unreadable catalog (503) or a passing Facebook read error (502): try again at the next wake-up; past the day it becomes "missed".
  if (status === 503 || status === 502) return result(order.id, 'blocked_retry', error.slice(0, 200), false)
  const next: ScheduledGrantStatus = status === 422 || status === 409 ? 'stale' : 'failed'
  if (!dryRun) await setGrant(deps, row, next, error.slice(0, 200))
  return result(order.id, next, error.slice(0, 200), true)
}

type Claimed =
  | { kind: 'claimed'; payload: Record<string, unknown> }
  | { kind: 'done'; result: ScheduledResult }

/** Grant check, grant claim and promote-authorization claim in ONE optimistic write on the latest payload. */
async function claimUnderGrant(
  deps: PromoteDeps,
  ctx: PromoteContext,
  row: TrafficRow,
  current: { today: string; currentPublishOn: string | null; currentFingerprint: string; isApprover: (e: string) => boolean },
  requestId: string,
  executedBy: string,
): Promise<Claimed> {
  let settled: ScheduledResult | null = null
  const res = await mutatePayload(deps, row, (cur) => {
    const grant = readGrant(cur)
    const chk = checkGrant({ grant, ...current })
    if (!chk.ok) {
      const outcome: ScheduledOutcome = chk.next === 'stale' ? 'stale' : chk.next === 'missed' ? 'missed' : 'not_due'
      settled = result(ctx.order.id, outcome, chk.reason, outcome !== 'not_due')
      return grant && chk.next ? withGrant(cur, grantWithStatus(grant, chk.next, chk.reason, deps.now())) : chk.reason
    }
    if (!grant) return 'no_grant'
    const prior = readAuth(cur)
    const leaseLive = prior.status === 'claimed' && Date.parse(prior.claimed_at ?? '') + CLAIM_LEASE_MS > deps.now().getTime()
    if (leaseLive || prior.status === 'consumed') return `promote_${prior.status}`
    const nowIso = deps.now().toISOString()
    const withClaim = withGrant(cur, claimedGrant(grant, requestId, executedBy, deps.now()))
    return withAuth(withClaim, {
      authorized_by: grant.authorized_by, authorized_at: grant.authorized_at, work_order_id: ctx.order.id,
      video_id: ctx.videoId, page_id: ctx.pageId, fingerprint: ctx.fingerprint, request_id: requestId,
      attempt_id: requestId, status: 'claimed', claimed_at: nowIso, promote_called_at: prior.promote_called_at,
    })
  }, 1)
  if (settled) return { kind: 'done', result: settled }
  // Lost the write race or another request holds the reel: try again at the next wake-up, but let a person see it.
  if (!res.ok) return { kind: 'done', result: result(ctx.order.id, 'not_due', res.message, res.message !== 'not_today') }
  return { kind: 'claimed', payload: res.payload }
}
