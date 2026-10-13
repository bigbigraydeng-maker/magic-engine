/**
 * POST /api/clients/[id]/campaign-daily-plan/auto-publish/authorize
 *
 * Records a PM's standing authorisation for the daily-plan auto-publisher.
 * This route never publishes anything itself — it only proves the plan would
 * pass every publish gate today, then (on `confirm: true`) writes the grant
 * row and emits the authorisation event.
 *
 * Fail-closed by construction:
 *  - Only a *global* administrator (exact `ADMIN_EMAILS` match, via
 *    `isGlobalAdminEmail`) may authorise. `access.tier` is deliberately not
 *    consulted: a scoped/demo admin has FDE powers inside one client, but
 *    arming an unattended scheduler is a global decision.
 *  - The full publish gate chain runs as a DRY RUN before anything is stored,
 *    so a plan that would be refused at publish time cannot be authorised now.
 *  - `confirm` defaults to `false`: a caller who says nothing gets a preview,
 *    not an armed scheduler.
 *  - The grant is written inactive, armed (`activated_at`) only after its
 *    authorisation event was sent. If the event or the arming fails the grant is
 *    revoked by id before returning 500, so an authorisation without its event
 *    receipt is never armed. If that rollback fails too the response says so.
 *  - Recalled dates stay blocked unless the PM lists them in `lift_recalled_dates`.
 */
import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { isGlobalAdminEmail } from '@/lib/auth/whitelist'
import {
  CampaignDailyAutoPublishAuthorizeCommandSchema,
  DAILY_PLAN_AUTO_PUBLISH_AUTHORIZED_EVENT,
  DAILY_PLAN_AUTO_PUBLISH_REVOKED_EVENT,
  computeExpiry,
  judgeAuthorization,
} from '@/lib/campaign/daily-plan-auto-publish'
import {
  activateAuthorization,
  findReceiptRecalledDates,
  findRecalledDates,
  getActiveAuthorization,
  insertAuthorization,
  liftRecalledTombstones,
  revokeAuthorization,
} from '@/lib/campaign/daily-plan-auto-publish-store'
import { clearNonStickyAttempts } from '@/lib/campaign/daily-plan-auto-publish-worker-store'
import { runDailyPlanPublish } from '@/lib/campaign/daily-plan-publish-runner'
import { supabaseAdmin } from '@/lib/supabase'
import { sendInngestEvent } from '@/lib/workflows/inngest-event'

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Today's calendar date in New Zealand, as YYYY-MM-DD (en-CA formats that way). */
function nzToday(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Auckland' }).format(now)
}

/** A half-created grant younger than this may still be completing; do not supersede it. */
const STALE_INACTIVE_GRANT_MS = 5 * 60 * 1000

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const clientId = params.id

  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ success: false, error: access.error }, { status: access.status })
  }

  // Only a global administrator may arm the unattended publisher: an exact
  // `ADMIN_EMAILS` match that is not also limited to one client (a scoped/demo
  // admin has FDE powers inside one client, but this is a global decision).
  if (!isGlobalAdminEmail(access.user.email ?? '') || access.allowedClientId !== null) {
    return NextResponse.json({ success: false, error: 'GLOBAL_ADMIN_REQUIRED' }, { status: 403 })
  }

  const parsed = CampaignDailyAutoPublishAuthorizeCommandSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: 'INVALID_AUTHORIZE_COMMAND', details: parsed.error.flatten() },
      { status: 400 }
    )
  }
  const command = parsed.data
  if (command.client_id !== clientId) {
    return NextResponse.json({ success: false, error: 'CLIENT_ID_MISMATCH' }, { status: 400 })
  }

  try {
    // Cheap, read-only refusals first. A past date would be published
    // immediately (not at its scheduled slot), so it can never be authorised.
    const today = nzToday(new Date())
    const pastDates = command.dates.filter(date => date < today)
    if (pastDates.length > 0) {
      return NextResponse.json({ success: false, error: 'DATE_IN_PAST', dates: pastDates }, { status: 422 })
    }

    // The page must be the one this client is registered against. The dry run
    // below returns before any token lookup, so this binding is checked here
    // (read-only, no token, no Facebook call) rather than being silently stored.
    const { data: clientRow, error: clientError } = await supabaseAdmin
      .from('clients')
      .select('facebook_page_id')
      .eq('id', clientId)
      .maybeSingle()
    if (clientError) throw clientError
    const registeredPage = (clientRow as { facebook_page_id?: string | null } | null)?.facebook_page_id
    if (!registeredPage) {
      return NextResponse.json({ success: false, error: 'CLIENT_HAS_NO_FACEBOOK_PAGE' }, { status: 409 })
    }
    if (registeredPage !== command.page_id) {
      return NextResponse.json({ success: false, error: 'PAGE_ID_MISMATCH' }, { status: 409 })
    }

    // A recalled post must stay recalled: the manual receipt moves it out of
    // `published[]`, so the dry run alone would happily treat it as "pending".
    // Only dates the PM explicitly lists in `lift_recalled_dates` may be sent again.
    // Two sources, either one blocks: the tombstone table and the receipt's own `recalled[]`.
    const recallReadAt = new Date()
    const [tombstoned, receiptRecalled] = await Promise.all([
      findRecalledDates(command.plan_id, clientId, command.dates),
      findReceiptRecalledDates(command.plan_id, clientId),
    ])
    const recalledDates = command.dates.filter(date => tombstoned.includes(date) || receiptRecalled.includes(date))
    const blockedByRecall = recalledDates.filter(date => !command.lift_recalled_dates.includes(date))
    if (blockedByRecall.length > 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'DATE_RECALLED',
          dates: blockedByRecall,
          hint: 'These dates were recalled. List them in lift_recalled_dates to send them again, or drop them from dates.',
        },
        { status: 409 }
      )
    }
    const liftDates = recalledDates.filter(date => command.lift_recalled_dates.includes(date))

    // Run the complete publish gate chain as a DRY RUN.
    // Nothing is stored and no provider call is made; a refusal here means the
    // plan would be refused at publish time, so it must not be authorised now.
    const result = await runDailyPlanPublish({
      clientId,
      approvedByUserId: access.user.id,
      command: {
        client_id: command.client_id,
        campaign_id: command.campaign_id,
        plan_id: command.plan_id,
        plan_revision: command.plan_revision,
        review_revision: command.review_revision,
        page_id: command.page_id,
        dates: command.dates,
        approved: true,
        publish_authorization: true,
        no_publish: true,
        date_offset_days: 0,
      },
    })
    if (result.status !== 200) {
      return NextResponse.json(result.body, { status: result.status })
    }

    if (command.confirm !== true) {
      return NextResponse.json({
        success: true,
        mode: 'PREVIEW',
        authorization: 'NOT_AUTHORIZED',
        provider_impact: 'NONE',
        dates: command.dates,
        would_lift_recalled: liftDates,
        would_publish: result.body.would_publish,
        already_published: result.body.already_published,
      })
    }

    const now = new Date()

    // A previous grant for this plan that can no longer authorise anything
    // (expired, plan changed, or a half-created one that never armed) must not
    // block a fresh authorisation; a live one still does.
    const previous = await getActiveAuthorization(command.plan_id, clientId)
    if (previous !== null) {
      const verdict = judgeAuthorization(previous, {
        planId: command.plan_id,
        planRevision: command.plan_revision,
        reviewRevision: command.review_revision,
        now,
      })
      const staleInactive =
        !verdict.active &&
        verdict.reason === 'NOT_ACTIVATED' &&
        now.getTime() - Date.parse(previous.authorized_at) > STALE_INACTIVE_GRANT_MS
      const supersedable = !verdict.active && (verdict.reason === 'EXPIRED' || verdict.reason === 'PLAN_CHANGED' || staleInactive)
      if (supersedable) {
        await revokeAuthorization({
          planId: command.plan_id,
          clientId,
          authId: previous.id,
          byEmail: 'system:superseded',
          reason: `superseded by a new authorisation (${verdict.active ? 'active' : verdict.reason})`,
        })
        // Leave a machine-readable trace of the replaced grant (best-effort, never blocks).
        try {
          await sendInngestEvent({
            id: `${previous.request_id}:superseded`,
            name: DAILY_PLAN_AUTO_PUBLISH_REVOKED_EVENT,
            data: {
              request_id: previous.request_id,
              client_id: clientId,
              campaign_id: previous.campaign_id,
              plan_id: command.plan_id,
              revoked_by_email: 'system:superseded',
              reason: 'superseded by a new authorisation',
              authorization: 'REVOKED',
              provider_impact: 'NONE',
            },
          })
        } catch (error: unknown) {
          console.error('[auto-publish authorize] superseded event not sent', errorMessage(error))
        }
      }
    }

    const requestId = randomUUID()
    const expires = computeExpiry(now, command.expires_in_days)
    const authorizedByEmail = (access.user.email ?? '').toLowerCase().trim()

    const inserted = await insertAuthorization({
      request_id: requestId,
      client_id: command.client_id,
      campaign_id: command.campaign_id,
      plan_id: command.plan_id,
      plan_revision: command.plan_revision,
      review_revision: command.review_revision,
      page_id: command.page_id,
      dates: command.dates,
      lifted_dates: liftDates,
      max_per_day: command.max_per_day,
      authorized_by_email: authorizedByEmail,
      authorized_by_user_id: access.user.id,
      authorized_at: now.toISOString(),
      expires_at: expires.toISOString(),
    })
    if (!inserted.ok) {
      return NextResponse.json(
        {
          success: false,
          error: 'ALREADY_AUTHORIZED',
          hint: 'Revoke the current authorisation for this plan first.',
        },
        { status: 409 }
      )
    }
    const grant = inserted.authorization

    // Send the event, then arm the grant. Any failure from here on revokes this
    // exact grant (by id, never a newer one) and says whether that rollback worked.
    const rollBack = async (reason: string): Promise<'OK' | 'FAILED'> => {
      try {
        await revokeAuthorization({
          planId: command.plan_id,
          clientId,
          authId: grant.id,
          byEmail: 'system:authorize-failed',
          reason,
        })
        return 'OK'
      } catch {
        return 'FAILED'
      }
    }
    const failure = (error: string, rollback: 'OK' | 'FAILED') =>
      NextResponse.json(
        {
          success: false,
          error,
          rollback,
          ...(rollback === 'FAILED'
            ? { hint: 'The grant could not be rolled back and may still exist — revoke it explicitly.' }
            : {}),
        },
        { status: 500 }
      )

    try {
      await sendInngestEvent({
        id: requestId,
        name: DAILY_PLAN_AUTO_PUBLISH_AUTHORIZED_EVENT,
        data: {
          request_id: requestId,
          client_id: command.client_id,
          campaign_id: command.campaign_id,
          plan_id: command.plan_id,
          plan_revision: command.plan_revision,
          review_revision: command.review_revision,
          page_id: command.page_id,
          dates: command.dates,
          max_per_day: command.max_per_day,
          authorized_by_email: authorizedByEmail,
          authorized_by_user_id: access.user.id,
          expires_at: expires.toISOString(),
          authorization: 'AUTHORIZED',
          provider_impact: 'NONE',
          created_at: new Date().toISOString(),
        },
      })
    } catch {
      return failure('AUTHORIZATION_EVENT_NOT_SENT', await rollBack('authorization event could not be sent'))
    }

    let armed
    try {
      armed = await activateAuthorization({ authId: grant.id, clientId })
    } catch {
      return failure('AUTHORIZATION_NOT_ACTIVATED', await rollBack('authorization could not be activated'))
    }
    if (armed === null) {
      return NextResponse.json({ success: false, error: 'AUTHORIZATION_REVOKED_DURING_ARMING' }, { status: 409 })
    }

    // Housekeeping once the grant is armed: start the covered dates clean, then lift recall blocks last
    // (if anything above failed, the blocks all stay in place).
    try {
      await clearNonStickyAttempts({ planId: command.plan_id, clientId, dates: command.dates })
      await liftRecalledTombstones({ planId: command.plan_id, clientId, dates: liftDates, notNewerThan: recallReadAt })
    } catch (error: unknown) {
      console.error('[auto-publish authorize] clearing old attempts / lifting recall blocks failed', errorMessage(error))
      return failure('RECALL_BLOCKS_NOT_LIFTED', await rollBack('recall blocks could not be lifted'))
    }

    return NextResponse.json({
      success: true,
      mode: 'AUTHORIZED',
      provider_impact: 'NONE',
      authorization: armed,
      lifted_recalled: liftDates,
      note: 'Recorded only. The automatic publisher is not running yet.',
    })
  } catch (error: unknown) {
    console.error('[auto-publish authorize] failed', errorMessage(error))
    return NextResponse.json({ success: false, error: 'INTERNAL_ERROR' }, { status: 500 })
  }
}
