/**
 * Daily Plan auto-publish — one sweep of the unattended publisher.
 *
 * The sweep is the ONLY thing that turns a PM's recorded authorisation into a
 * Facebook submission, and it does so by calling the same publish runner the
 * manual route uses (`runDailyPlanPublish`) — it never re-implements a gate.
 * Everything it adds is about *whether it is allowed to act right now*:
 *
 *   authorisation   revoked / not armed / expired / plan changed -> do nothing
 *   scope           client archived or campaign not active       -> do nothing
 *   recall          tombstone, or the receipt's `recalled[]` unless lifted -> never
 *   window          only today and tomorrow (NZ); a slot that has passed is
 *                   MISSED_WINDOW, never a late post
 *   gates           the whole pending plan is dry-run first; one refusal pauses
 *                   every date of that plan (the manual route's rule)
 *   claim           one atomic row per (plan, date) before anything is sent;
 *                   a claim with no result is UNKNOWN_OUTCOME and is never retried
 *   mode            practice (dry run) unless the live switch AND the client
 *                   allow-list both say so; practice writes nothing
 *
 * All I/O is injected so the sweep can be exercised end to end without a
 * network: see `__tests__/daily-plan-auto-publish-worker.test.ts`.
 */
import { randomUUID } from 'node:crypto'
import {
  DAILY_PLAN_AUTO_PUBLISH_ATTEMPTED_EVENT,
  judgeAuthorization,
  type AutoPublishAuthorization,
} from './daily-plan-auto-publish'
import {
  AUTO_PUBLISH_STALE_CLAIM_MINUTES,
  classifyRunResult,
  decideClaim,
  dueWindowDates,
  isLiveFor,
  isRecallBlocked,
  isStaleClaim,
  nzDateString,
  type AttemptOutcome,
  type AutoPublishSwitches,
} from './daily-plan-auto-publish-decide'
import type { AttemptPatch, AttemptRecord } from './daily-plan-auto-publish-worker-store'
import { resolvePublishSchedule, type CampaignDailyPublishCommand } from './daily-plan-publish'

/** Upper bound for one Facebook call made by the unattended publisher. */
const UNATTENDED_REQUEST_TIMEOUT_MS = 45_000

/** What the sweep needs to know about a plan right now (read fresh every sweep). */
export interface PlanState {
  planRevision: string
  reviewRevision: string
  /** Dates already on the receipt's `published[]`. */
  publishedDates: string[]
  /** Dates on the receipt's `recalled[]`. */
  receiptRecalledDates: string[]
  /** Latest `recalled_at` per recalled date (ISO). Optional: absent counts as "unknown time" and voids any lift. */
  receiptRecalledAt?: Record<string, string>
  /**
   * Dates on the receipt's `failed[]` whose certainty is `unknown` or missing: a manual publish may have
   * reached Facebook. Never re-sent automatically; a human settles them.
   */
  receiptUnknownFailedDates?: string[]
  /** Post id per published date, from the receipt (used to close an attempt row left in `claimed`). */
  publishedPostIds?: Record<string, string>
}

export interface ScopeState {
  clientStatus: string | null
  campaignStatus: string | null
}

export interface RunPublishInput {
  clientId: string
  command: CampaignDailyPublishCommand
  approvedByUserId: string
  now: Date
  allowImmediate: false
  /** Request timeout for the Facebook call (the unattended publisher always sets one). */
  requestTimeoutMs?: number
  /** Last-moment check, run right before the Facebook call: false = do not send. */
  beforeSend?: (date: string) => Promise<boolean>
}

export interface AutoPublishWorkerDeps {
  /** The instant this sweep started; every schedule decision uses it. */
  now: Date
  /** The real clock, for re-checks made later in the sweep (default `new Date()`). Injectable for tests. */
  clock?: () => Date
  switches: AutoPublishSwitches
  listLiveAuthorizations: () => Promise<AutoPublishAuthorization[]>
  /** Is this still a global administrator? Checked on every sweep: a grant outlives neither its author's role nor their account. */
  isGlobalAdmin: (email: string) => boolean
  /** The grant for this plan if it is still not revoked (null once revoked). */
  getActiveAuthorization: (planId: string, clientId: string) => Promise<AutoPublishAuthorization | null>
  loadPlanState: (planId: string, clientId: string) => Promise<PlanState | null>
  loadScope: (clientId: string, campaignId: string) => Promise<ScopeState>
  listAttempts: (planId: string, clientId: string, dates: string[]) => Promise<AttemptRecord[]>
  claimAttempt: (input: {
    authId: string
    clientId: string
    planId: string
    date: string
    requestId: string
    attemptNo: number
    now: Date
    fromStatus?: AttemptRecord['status']
  }) => Promise<boolean>
  finishAttempt: (input: { planId: string; date: string; requestId: string; patch: AttemptPatch; now: Date }) => Promise<boolean>
  runPublish: (input: RunPublishInput) => Promise<{ status: number; body: Record<string, unknown> }>
  /** Best-effort machine-readable receipt; the attempts table is the source of truth. */
  emit: (event: { id: string; name: string; data: Record<string, unknown> }) => Promise<void>
}

export interface SweepDateRecord {
  client_id: string
  plan_id: string
  date: string
  mode: 'live' | 'practice'
  /** What happened, or what a live sweep would have done. */
  result: string
  reason?: string
}

export interface SweepSummary {
  ran_at: string
  authorizations: number
  records: SweepDateRecord[]
  /** Counts by `result`, for the run log. */
  counts: Record<string, number>
}

interface DatePlan {
  date: string
  existing: AttemptRecord | null
  decision: ReturnType<typeof decideClaim>
}

function patchFromOutcome(outcome: AttemptOutcome): AttemptPatch {
  switch (outcome.status) {
    case 'published':
      return {
        status: 'published',
        reason_code: outcome.reasonCode,
        post_id: outcome.postId,
        scheduled_publish_time: outcome.scheduledPublishTime,
        provider_impact: 'FB_SCHEDULED',
        next_retry_at: null,
      }
    case 'failed_retryable':
      return { status: 'failed_retryable', reason_code: outcome.reasonCode, next_retry_at: outcome.nextRetryAt }
    default:
      return { status: outcome.status, reason_code: outcome.reasonCode, next_retry_at: null }
  }
}

function buildCommand(auth: AutoPublishAuthorization, dates: string[], noPublish: boolean): CampaignDailyPublishCommand {
  return {
    client_id: auth.client_id,
    campaign_id: auth.campaign_id,
    plan_id: auth.plan_id,
    plan_revision: auth.plan_revision,
    review_revision: auth.review_revision,
    page_id: auth.page_id,
    dates,
    approved: true,
    publish_authorization: true,
    no_publish: noPublish,
    date_offset_days: 0,
  }
}

/** Run one sweep over every armed, unexpired authorisation. Never throws for a single plan's problem. */
export async function runAutoPublishSweep(deps: AutoPublishWorkerDeps): Promise<SweepSummary> {
  const { now } = deps
  const records: SweepDateRecord[] = []
  const grants = await deps.listLiveAuthorizations()
  const window = dueWindowDates(now)
  const today = nzDateString(now)

  for (const auth of grants) {
    const live = isLiveFor(deps.switches, auth.client_id)
    const mode: SweepDateRecord['mode'] = live ? 'live' : 'practice'
    const note = (date: string, result: string, reason?: string) =>
      records.push({ client_id: auth.client_id, plan_id: auth.plan_id, date, mode, result, ...(reason ? { reason } : {}) })

    try {
      const state = await deps.loadPlanState(auth.plan_id, auth.client_id)
      if (state === null) {
        note('*', 'skipped', 'PLAN_NOT_FOUND')
        continue
      }

      const verdict = judgeAuthorization(auth, {
        planId: auth.plan_id,
        planRevision: state.planRevision,
        reviewRevision: state.reviewRevision,
        now,
      })
      if (!verdict.active) {
        note('*', 'skipped', verdict.reason)
        continue
      }

      if (!deps.isGlobalAdmin(auth.authorized_by_email)) {
        note('*', 'skipped', 'AUTHORIZER_NOT_ADMIN')
        continue
      }

      const scope = await deps.loadScope(auth.client_id, auth.campaign_id)
      if (scope.clientStatus !== 'active' || scope.campaignStatus !== 'active') {
        note('*', 'skipped', 'CLIENT_OR_CAMPAIGN_INACTIVE')
        continue
      }

      const dueDates = auth.dates.filter(date => window.includes(date)).sort()

      // A manual publish of some date failed with an uncertain result: Facebook may already have the Post.
      // Park EVERY such authorised date (not only the ones due now) as UNKNOWN_OUTCOME, so the fact lands in
      // the durable attempts table before a later manual run overwrites the receipt's `failed[]`.
      const parkDates = (state.receiptUnknownFailedDates ?? [])
        .filter(date => auth.dates.includes(date) && !state.publishedDates.includes(date) && date >= today)
        .sort()
      if (dueDates.length === 0 && parkDates.length === 0) continue

      const attempts = await deps.listAttempts(auth.plan_id, auth.client_id, Array.from(new Set([...dueDates, ...parkDates])))
      const attemptByDate = new Map(attempts.map(row => [row.date, row]))
      const evidence = {
        tombstoneDates: attempts.filter(r => r.status === 'blocked' && r.reason_code === 'RECALLED').map(r => r.date),
        receiptRecalledDates: state.receiptRecalledDates,
        liftedDates: effectiveLiftedDates(auth, state),
      }

      const parked = new Set<string>()
      for (const date of parkDates) {
        if (attemptByDate.has(date)) continue // already has a row: decideClaim / stale-claim handling decides
        if (isRecallBlocked(date, evidence)) continue
        if (live) {
          const requestId = randomUUID()
          const claimed = await deps.claimAttempt({
            authId: auth.id, clientId: auth.client_id, planId: auth.plan_id, date, requestId, attemptNo: 1, now,
          })
          if (claimed) {
            await deps.finishAttempt({
              planId: auth.plan_id, date, requestId,
              patch: { status: 'unknown_outcome', reason_code: 'RECEIPT_FAILED_UNKNOWN', next_retry_at: null },
              now,
            })
          }
        }
        parked.add(date)
        note(date, 'unknown_outcome', 'RECEIPT_FAILED_UNKNOWN')
      }

      // 1. Per-date eligibility.
      const todo: DatePlan[] = []
      for (const date of dueDates) {
        if (state.publishedDates.includes(date)) {
          // The receipt says it is out. If our own attempt row was left in `claimed` (the write-back
          // failed after a successful send), close it now so it can never look like an open claim.
          const left = attemptByDate.get(date)
          if (live && left !== undefined && left.status === 'claimed') {
            await deps.finishAttempt({
              planId: auth.plan_id,
              date,
              requestId: left.request_id,
              patch: {
                status: 'published',
                reason_code: 'RECONCILED_FROM_RECEIPT',
                post_id: state.publishedPostIds?.[date] ?? null,
                provider_impact: 'FB_SCHEDULED',
                next_retry_at: null,
              },
              now,
            })
          }
          note(date, 'skipped', 'ALREADY_PUBLISHED')
          continue
        }
        if (isRecallBlocked(date, evidence)) {
          note(date, 'skipped', 'RECALLED')
          continue
        }
        const existing = attemptByDate.get(date) ?? null
        if (parked.has(date)) continue
        if (existing !== null && isStaleClaim(existing, now)) {
          // A claim that never reported back: the Post may or may not exist. Never retry blindly.
          if (live) {
            await deps.finishAttempt({
              planId: auth.plan_id,
              date,
              requestId: existing.request_id,
              patch: { status: 'unknown_outcome', reason_code: 'STALE_CLAIM' },
              now,
            })
          }
          note(date, 'unknown_outcome', `STALE_CLAIM_OVER_${AUTO_PUBLISH_STALE_CLAIM_MINUTES}_MIN`)
          continue
        }
        const decision = decideClaim(existing, now)
        if (decision.action === 'skip') {
          note(date, 'skipped', decision.reason)
          continue
        }
        todo.push({ date, existing, decision })
      }

      // 2. A slot that has already passed is never published late.
      const sendable: DatePlan[] = []
      for (const item of todo) {
        const slot = resolvePublishSchedule(item.date, now, 0)
        if (item.date < today || slot.publishNow) {
          if (live) {
            const requestId = randomUUID()
            const claimed = await claimFor(deps, auth, item, requestId, now)
            if (claimed) {
              await deps.finishAttempt({
                planId: auth.plan_id,
                date: item.date,
                requestId,
                patch: { status: 'missed_window', reason_code: 'MISSED_WINDOW', next_retry_at: null },
                now,
              })
              await emitAttempt(deps, auth, item.date, requestId, 'missed_window', 'MISSED_WINDOW', now)
            }
          }
          note(item.date, 'missed_window', 'MISSED_WINDOW')
          continue
        }
        sendable.push(item)
      }
      if (sendable.length === 0) continue

      // 3. The whole pending plan must pass every gate; one refusal pauses all of it.
      const gateDates = auth.dates
        .filter(date => date >= today && !state.publishedDates.includes(date) && !isRecallBlocked(date, evidence))
        .sort()
      const gate = await deps.runPublish({
        clientId: auth.client_id,
        command: buildCommand(auth, gateDates, true),
        approvedByUserId: auth.authorized_by_user_id,
        now,
        allowImmediate: false,
      })
      if (gate.status !== 200) {
        const reason = typeof gate.body.error === 'string' && gate.body.error ? gate.body.error : `HTTP_${gate.status}`
        for (const item of sendable) {
          // Same refusal as the last sweep: nothing new to record (no re-claim, no new event every hour).
          if (item.existing?.status === 'blocked' && item.existing.reason_code === reason) {
            note(item.date, 'blocked', reason)
            continue
          }
          if (live) {
            const requestId = randomUUID()
            const claimed = await claimFor(deps, auth, item, requestId, now)
            if (claimed) {
              await deps.finishAttempt({
                planId: auth.plan_id,
                date: item.date,
                requestId,
                patch: { status: 'blocked', reason_code: reason, next_retry_at: null },
                now,
              })
              await emitAttempt(deps, auth, item.date, requestId, 'blocked', reason, now)
            }
          }
          note(item.date, 'blocked', reason)
        }
        continue
      }

      // 4. Practice mode stops here: it proved every gate passes, and sends nothing.
      if (!live) {
        for (const item of sendable) note(item.date, 'would_publish')
        continue
      }

      // 5. Live: serial, one date at a time, re-checking the grant before each send.
      for (const item of sendable) {
        const stillGranted = await deps.getActiveAuthorization(auth.plan_id, auth.client_id)
        if (
          stillGranted === null ||
          stillGranted.id !== auth.id ||
          !judgeAuthorization(stillGranted, {
            planId: auth.plan_id,
            planRevision: state.planRevision,
            reviewRevision: state.reviewRevision,
            now: (deps.clock ?? (() => new Date()))(),
          }).active
        ) {
          note(item.date, 'skipped', 'REVOKED_DURING_SWEEP')
          break
        }

        const requestId = randomUUID()
        const attemptNo = nextAttemptNo(item)
        const claimed = await claimFor(deps, auth, item, requestId, now, attemptNo)
        if (!claimed) {
          note(item.date, 'skipped', 'CLAIM_LOST')
          continue
        }

        // Last-moment check, used twice: right after the claim and again just before the Facebook call.
        const grantStillGood = async (): Promise<boolean> => {
          const grantNow = await deps.getActiveAuthorization(auth.plan_id, auth.client_id)
          return (
            grantNow !== null &&
            grantNow.id === auth.id &&
            judgeAuthorization(grantNow, {
              planId: auth.plan_id,
              planRevision: state.planRevision,
              reviewRevision: state.reviewRevision,
              now: (deps.clock ?? (() => new Date()))(),
            }).active
          )
        }
        const claimStillMine = async (): Promise<boolean> => {
          const rows = await deps.listAttempts(auth.plan_id, auth.client_id, [item.date])
          return rows.some(row => row.request_id === requestId && row.status === 'claimed')
        }
        const stillMine = async (): Promise<boolean> => (await grantStillGood()) && (await claimStillMine())
        const grantOk = await grantStillGood()
        if (!grantOk || !(await claimStillMine())) {
          await deps.finishAttempt({
            planId: auth.plan_id,
            date: item.date,
            requestId,
            patch: { status: 'blocked', reason_code: 'ABORTED_BEFORE_SEND', next_retry_at: null },
            now,
          })
          note(item.date, 'blocked', 'ABORTED_BEFORE_SEND')
          // The grant is gone: stop the whole plan. Only this date's claim was taken: carry on with the others.
          if (!grantOk) break
          continue
        }

        let outcome: AttemptOutcome
        try {
          const result = await deps.runPublish({
            clientId: auth.client_id,
            command: buildCommand(auth, [item.date], false),
            approvedByUserId: auth.authorized_by_user_id,
            now,
            allowImmediate: false,
            requestTimeoutMs: UNATTENDED_REQUEST_TIMEOUT_MS,
            beforeSend: stillMine,
          })
          outcome = classifyRunResult({ date: item.date, httpStatus: result.status, body: result.body, attemptNo, now })
        } catch {
          // The runner threw after we claimed: Facebook may or may not have the Post.
          outcome = { status: 'unknown_outcome', reasonCode: 'RUNNER_THREW' }
        }

        const finished = await deps.finishAttempt({
          planId: auth.plan_id,
          date: item.date,
          requestId,
          patch: patchFromOutcome(outcome),
          now,
        })
        await emitAttempt(deps, auth, item.date, requestId, outcome.status, 'reasonCode' in outcome ? outcome.reasonCode : null, now)
        if (finished) {
          note(item.date, outcome.status, outcome.status === 'published' ? undefined : outcome.reasonCode)
        } else {
          // The send may have gone out but its record could not be written (the claim changed under us).
          // Surface the post id in the run log and count it as an error so it cannot pass unnoticed.
          const postId = outcome.status === 'published' ? outcome.postId : null
          note(item.date, 'error', `FINISH_LOST_CLAIM_CHANGED${postId ? ` post_id=${postId}` : ''} outcome=${outcome.status}`)
        }
      }
    } catch (error: unknown) {
      // One plan's failure must not stop the others; the record is what the run log shows.
      note('*', 'error', error instanceof Error ? error.message.slice(0, 200) : 'UNKNOWN_ERROR')
    }
  }

  const counts: Record<string, number> = {}
  for (const record of records) counts[record.result] = (counts[record.result] ?? 0) + 1
  return { ran_at: now.toISOString(), authorizations: grants.length, records, counts }
}

/**
 * A lift only counts for a recall that happened before the grant was written: a recall AFTER the
 * authorisation (or one whose time we cannot read) must never be waved through by an old lift.
 */
function effectiveLiftedDates(auth: AutoPublishAuthorization, state: PlanState): string[] {
  const authorizedAt = Date.parse(auth.authorized_at)
  return auth.lifted_dates.filter(date => {
    if (!state.receiptRecalledDates.includes(date)) return true
    const recalledAt = Date.parse(state.receiptRecalledAt?.[date] ?? '')
    return !Number.isNaN(recalledAt) && !Number.isNaN(authorizedAt) && recalledAt <= authorizedAt
  })
}

function nextAttemptNo(item: DatePlan): number {
  if (item.existing === null) return 1
  return item.decision.action === 'reclaim' && item.decision.fromStatus === 'failed_retryable'
    ? item.existing.attempt_no + 1
    : Math.max(item.existing.attempt_no, 1)
}

async function claimFor(
  deps: AutoPublishWorkerDeps,
  auth: AutoPublishAuthorization,
  item: DatePlan,
  requestId: string,
  now: Date,
  attemptNo: number = nextAttemptNo(item),
): Promise<boolean> {
  return deps.claimAttempt({
    authId: auth.id,
    clientId: auth.client_id,
    planId: auth.plan_id,
    date: item.date,
    requestId,
    attemptNo,
    // the real moment of the claim (not the sweep's start): the manual publish guard judges freshness by it
    now: (deps.clock ?? (() => new Date()))(),
    ...(item.decision.action === 'reclaim' ? { fromStatus: item.decision.fromStatus } : {}),
  })
}

async function emitAttempt(
  deps: AutoPublishWorkerDeps,
  auth: AutoPublishAuthorization,
  date: string,
  requestId: string,
  status: string,
  reasonCode: string | null,
  now: Date,
): Promise<void> {
  try {
    await deps.emit({
      id: `${requestId}:attempted`,
      name: DAILY_PLAN_AUTO_PUBLISH_ATTEMPTED_EVENT,
      data: {
        request_id: requestId,
        client_id: auth.client_id,
        campaign_id: auth.campaign_id,
        plan_id: auth.plan_id,
        date,
        status,
        reason_code: reasonCode,
        provider_impact: status === 'published' ? 'FB_SCHEDULED' : 'NONE',
        cost_usd: 0,
        no_publish: false,
        created_at: now.toISOString(),
      },
    })
  } catch {
    // The attempts table is the receipt of record; a lost event never changes an outcome.
  }
}
