/**
 * POST /api/clients/[id]/campaign-daily-plan/publish
 *
 * The Facebook publish bridge for reviewed Campaign Daily Plan Posts — the
 * first stage in this pipeline allowed to cause a real provider side effect.
 *
 * Fail-closed by construction:
 *  - `approved` and `publish_authorization` are `z.literal(true)`, so a
 *    command missing either is rejected at parse time, before any DB read,
 *    token lookup or Graph call.
 *  - `no_publish` defaults to `true`. A dry run performs no provider call, no
 *    event and no write; it only reports what a live run would do.
 *  - A live run additionally requires the no-publish queue receipt for the
 *    exact same plan+review revision to already exist, so unreviewed or
 *    re-edited content can never reach a Page.
 *  - Every Post carries a deterministic idempotency key; an already-published
 *    key is skipped rather than posted twice.
 *
 * This route owns only authentication and command parsing. The publish flow
 * itself lives in `@/lib/campaign/daily-plan-publish-runner` so that a second
 * caller runs the same gates in the same order. It reuses the production Meta
 * Graph module (`@/lib/meta/page-posts`); there is no second publishing client.
 */
import { NextRequest, NextResponse } from 'next/server'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { CampaignDailyPublishCommandSchema } from '@/lib/campaign/daily-plan-publish'
import { runDailyPlanPublish } from '@/lib/campaign/daily-plan-publish-runner'
import { randomUUID } from 'crypto'
import {
  claimManualAttempt,
  type AttemptRecord,
  finishAttempt,
  isMissingTableError,
  listFreshClaims,
  listUnconfirmedAttempts,
} from '@/lib/campaign/daily-plan-auto-publish-worker-store'
import { manualAttemptPatch, type ManualClaim } from '@/lib/campaign/daily-plan-manual-claim'

/** A claim younger than this belongs to a sweep that may still be sending. */
const AUTO_PUBLISH_CLAIM_FRESH_MS = 15 * 60 * 1000

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const clientId = params.id
  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ success: false, error: access.error }, { status: access.status })
  }

  const parsed = CampaignDailyPublishCommandSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: 'INVALID_PUBLISH_COMMAND', details: parsed.error.flatten() },
      { status: 400 }
    )
  }
  const command = parsed.data
  if (command.client_id !== clientId) {
    return NextResponse.json({ success: false, error: 'CLIENT_ID_MISMATCH' }, { status: 400 })
  }

  try {
    // The unattended publisher may be sending one of these dates right now. A live manual publish of the
    // same date at the same moment is how a Post gets published twice, so refuse and let the sweep finish.
    if (!command.no_publish) {
      // If the auto-publish tables are not there at all, there is no unattended publisher to collide with; any
      // other read failure stops the publish (fail closed).
      const freshSince = new Date(Date.now() - AUTO_PUBLISH_CLAIM_FRESH_MS)
      const readAttempts = (read: () => Promise<AttemptRecord[]>): Promise<AttemptRecord[]> =>
        read().catch(error => {
          if (isMissingTableError(error)) return []
          throw error
        })
      const [claims, unconfirmed] = await Promise.all([
        readAttempts(() => listFreshClaims(command.plan_id, clientId, freshSince)),
        readAttempts(() => listUnconfirmedAttempts(command.plan_id, clientId, freshSince)),
      ])
      const wanted = (attempt: { date: string }) => !command.dates || command.dates.includes(attempt.date)
      // An unconfirmed date may already be on the Page: publishing it again by hand is how a Post goes out twice.
      const unsureRows = unconfirmed.filter(wanted)
      const unsure = unsureRows.map(attempt => attempt.date)
      if (unsure.length > 0) {
        // A claim nobody closed (a dead process, a failed write) would otherwise block this date forever: nothing
        // else turns it into something a person can act on while auto-publish is only practising. Mark it
        // unknown_outcome (guarded by its own request id, so a live claim that finishes meanwhile is untouched).
        await Promise.all(
          unsureRows
            .filter(row => row.status === 'claimed')
            .map(row =>
              finishAttempt({
                planId: command.plan_id,
                date: row.date,
                requestId: row.request_id,
                patch: { status: 'unknown_outcome', reason_code: 'STALE_CLAIM', next_retry_at: null },
                now: new Date(),
              }).catch(error => {
                console.error('[daily-plan publish] could not mark a stale claim as unknown', { clientId, date: row.date, error: errorMessage(error) })
                return false
              })
            )
        )
        return NextResponse.json(
          {
            success: false,
            error: 'AUTO_PUBLISH_UNCONFIRMED',
            dates: unsure,
            hint: '自动发布没确认这些日期有没有已经发出去。先去 Facebook 主页看一眼，再到今日待办里点「确认」（已发出 / 没发出）；确认完再手动发，避免同一条发两次。',
          },
          { status: 409 }
        )
      }
      const busy = claims.filter(wanted).map(claim => claim.date)
      if (busy.length > 0) {
        return NextResponse.json(
          { success: false, error: 'AUTO_PUBLISH_IN_PROGRESS', dates: busy, hint: '自动发布正在处理这些日期，等几分钟后再试。' },
          { status: 409 }
        )
      }
    }
    if (command.no_publish) {
      const result = await runDailyPlanPublish({ clientId, command, approvedByUserId: access.user.id })
      return NextResponse.json(result.body, { status: result.status })
    }

    // A live manual publish takes the same per-date claim the unattended publisher uses, so the two can never
    // send one date at the same moment. Dates are claimed one by one right before their Facebook call.
    const requestId = randomUUID()
    const claimed = new Map<string, ManualClaim>()
    // Dates where the claim call threw: the write may still have landed, so they are closed as unknown too.
    const maybeClaimed = new Set<string>()
    const claimDate = async (date: string): Promise<boolean> => {
      let taken: Awaited<ReturnType<typeof claimManualAttempt>> | { claimed: true; restoreRecalled: false; untracked: true }
      try {
        taken = await claimManualAttempt({ clientId, planId: command.plan_id, date, requestId, now: new Date() })
      } catch (error) {
        // No attempts table at all means there is no unattended publisher to share a date with.
        if (isMissingTableError(error)) return true
        maybeClaimed.add(date)
        throw error
      }
      if (!taken.claimed) return false
      claimed.set(date, { restoreRecalled: taken.restoreRecalled })
      return true
    }
    const closeOne = async (date: string, claim: ManualClaim, receipt: unknown): Promise<boolean> => {
      const patch = manualAttemptPatch(date, receipt, claim)
      // One retry: a claim left open blocks the date until a person resolves it.
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        try {
          return await finishAttempt({ planId: command.plan_id, date, requestId, patch, now: new Date() })
        } catch (error) {
          console.error('[daily-plan publish] could not close the manual claim', { clientId, planId: command.plan_id, date, attempt, error: errorMessage(error) })
        }
      }
      return false
    }
    const closeClaims = async (receipt: unknown) => {
      for (const [date, claim] of claimed) {
        if (!(await closeOne(date, claim, receipt))) {
          console.error('[daily-plan publish] manual claim was not closed', { clientId, planId: command.plan_id, date })
        }
      }
      // A date whose claim call threw may or may not hold our row; closing it is a no-op when it does not.
      for (const date of maybeClaimed) {
        if (!claimed.has(date)) await closeOne(date, { restoreRecalled: false }, null)
      }
    }

    let result: Awaited<ReturnType<typeof runDailyPlanPublish>>
    try {
      result = await runDailyPlanPublish({ clientId, command, approvedByUserId: access.user.id, beforeSend: claimDate })
    } catch (error: unknown) {
      // The run died somewhere between claiming a date and recording the outcome: Facebook may hold the Post.
      await closeClaims(null)
      throw error
    }
    await closeClaims((result.body as { receipt?: unknown }).receipt)
    return NextResponse.json(result.body, { status: result.status })
  } catch (error: unknown) {
    return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 500 })
  }
}
