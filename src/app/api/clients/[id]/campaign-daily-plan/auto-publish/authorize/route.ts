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
 *  - If the authorisation event cannot be sent, the grant is revoked before
 *    returning 500 — an authorisation without its event receipt must not stay
 *    active.
 */
import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { isGlobalAdminEmail } from '@/lib/auth/whitelist'
import {
  CampaignDailyAutoPublishAuthorizeCommandSchema,
  DAILY_PLAN_AUTO_PUBLISH_AUTHORIZED_EVENT,
  computeExpiry,
} from '@/lib/campaign/daily-plan-auto-publish'
import {
  insertAuthorization,
  revokeAuthorization,
} from '@/lib/campaign/daily-plan-auto-publish-store'
import { runDailyPlanPublish } from '@/lib/campaign/daily-plan-publish-runner'
import { sendInngestEvent } from '@/lib/workflows/inngest-event'

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const clientId = params.id

  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ success: false, error: access.error }, { status: access.status })
  }

  // Only a global administrator may arm the unattended publisher. A scoped
  // admin (DEMO_ADMINS / scoped_admin) has FDE powers inside one client, but
  // this is a global decision, so `access.tier` is not consulted here.
  if (!isGlobalAdminEmail(access.user.email ?? '')) {
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
    // Run the complete publish gate chain as a DRY RUN. Nothing is stored and
    // no provider call is made; a refusal here means the plan would be refused
    // at publish time, so it must not be authorised now.
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
        would_publish: result.body.would_publish,
        already_published: result.body.already_published,
      })
    }

    const now = new Date()
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

    const createdAt = new Date().toISOString()
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
          created_at: createdAt,
        },
      })
    } catch {
      // An authorisation without its event receipt must not stay active. If the
      // rollback itself fails the grant is still armed, so say so in the response
      // instead of letting a bare 500 look like "nothing happened".
      let rollback: 'OK' | 'FAILED' = 'OK'
      try {
        await revokeAuthorization({
          planId: command.plan_id,
          byEmail: 'system:event-failed',
          reason: 'authorization event could not be sent',
        })
      } catch {
        rollback = 'FAILED'
      }
      return NextResponse.json(
        {
          success: false,
          error: 'AUTHORIZATION_EVENT_NOT_SENT',
          rollback,
          ...(rollback === 'FAILED'
            ? { hint: 'The grant could not be rolled back and may still be active — revoke it explicitly.' }
            : {}),
        },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      mode: 'AUTHORIZED',
      provider_impact: 'NONE',
      authorization: inserted.authorization,
      note: 'Recorded only. The automatic publisher is not running yet.',
    })
  } catch (error: unknown) {
    return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 500 })
  }
}
