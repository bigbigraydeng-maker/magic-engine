/**
 * POST /api/clients/[id]/campaign-daily-plan/auto-publish/revoke
 *
 * Revokes the active standing authorisation for the daily-plan auto-publisher.
 * This route never publishes anything and never takes a post down — it only
 * disarms the scheduler for future dates.
 *
 * Fail-closed by construction:
 *  - Only a *global* administrator (exact `ADMIN_EMAILS` match, via
 *    `isGlobalAdminEmail`) may revoke. `access.tier` is deliberately not
 *    consulted: disarming an unattended scheduler is a global decision.
 *  - Revocation must always work and must never depend on the event system.
 *    The event is best-effort: a failure only downgrades `event_status` to
 *    `failed` and never undoes the revocation.
 *  - Posts already handed to Facebook stay scheduled; the response reports
 *    them so a human can recall them explicitly. When that read cannot be
 *    trusted the status is `UNKNOWN` rather than an empty list, because
 *    claiming "nothing is in flight" when we could not check would be a lie.
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { isGlobalAdminEmail } from '@/lib/auth/whitelist'
import {
  CampaignDailyAutoPublishRevokeCommandSchema,
  DAILY_PLAN_AUTO_PUBLISH_REVOKED_EVENT,
} from '@/lib/campaign/daily-plan-auto-publish'
import { revokeAuthorization } from '@/lib/campaign/daily-plan-auto-publish-store'
import { readAutoPublishRecords } from '@/lib/campaign/daily-plan-auto-publish-records'
import { CampaignDailyPublishMetaSchema } from '@/lib/campaign/daily-plan-publish'
import { supabaseAdmin } from '@/lib/supabase'
import { sendInngestEvent } from '@/lib/workflows/inngest-event'

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

interface InFlightPost {
  date: string
  post_id: string
  scheduled_publish_time: string
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const clientId = params.id

  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ success: false, error: access.error }, { status: access.status })
  }

  // Only a global administrator may disarm the unattended publisher. A scoped
  // admin (DEMO_ADMINS / scoped_admin) has FDE powers inside one client, but
  // this is a global decision, so `access.tier` is not consulted here.
  if (!isGlobalAdminEmail(access.user.email ?? '') || access.allowedClientId !== null) {
    return NextResponse.json({ success: false, error: 'GLOBAL_ADMIN_REQUIRED' }, { status: 403 })
  }

  const parsed = CampaignDailyAutoPublishRevokeCommandSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: 'INVALID_REVOKE_COMMAND', details: parsed.error.flatten() },
      { status: 400 }
    )
  }
  const command = parsed.data
  if (command.client_id !== clientId) {
    return NextResponse.json({ success: false, error: 'CLIENT_ID_MISMATCH' }, { status: 400 })
  }

  const revokedByEmail = (access.user.email ?? '').toLowerCase().trim()

  let revoked
  try {
    revoked = await revokeAuthorization({
      planId: command.plan_id,
      clientId,
      byEmail: revokedByEmail,
      reason: command.reason,
    })
  } catch (error: unknown) {
    console.error('[auto-publish revoke] revoke failed', errorMessage(error))
    return NextResponse.json({ success: false, error: 'INTERNAL_ERROR' }, { status: 500 })
  }

  if (revoked === null) {
    return NextResponse.json({ success: false, error: 'NO_ACTIVE_AUTHORIZATION' }, { status: 404 })
  }

  // Best-effort event. A failure here must never undo the revocation — the
  // desired end state (scheduler disarmed) already holds.
  let eventStatus: 'sent' | 'failed' = 'sent'
  try {
    await sendInngestEvent({
      id: `${revoked.request_id}:revoked`,
      name: DAILY_PLAN_AUTO_PUBLISH_REVOKED_EVENT,
      data: {
        request_id: revoked.request_id,
        client_id: clientId,
        // taken from the stored grant, not the request body
        campaign_id: revoked.campaign_id,
        plan_id: command.plan_id,
        revoked_by_email: revokedByEmail,
        reason: command.reason,
        revoked_at: revoked.revoked_at,
        authorization: 'REVOKED',
        provider_impact: 'NONE',
      },
    })
  } catch {
    eventStatus = 'failed'
  }

  // Revoking does not take down posts already handed to Facebook. Report the
  // ones still scheduled so a human can recall them explicitly. This step is
  // wrapped so a read failure cannot fail the response.
  let inFlight: InFlightPost[] = []
  let inFlightStatus: 'OK' | 'UNKNOWN' = 'UNKNOWN'
  const receiptPostIds = new Set<string>()
  try {
    const { data, error } = await supabaseAdmin
      .from('social_plans')
      .select('plan_data')
      .eq('id', command.plan_id)
      .eq('client_id', clientId)
      .maybeSingle()

    if (!error && data !== null) {
      const planData = (data as { plan_data: unknown }).plan_data
      const publishMeta =
        planData !== null && typeof planData === 'object'
          ? (planData as { publish_meta?: unknown }).publish_meta
          : undefined
      const metaParsed = CampaignDailyPublishMetaSchema.safeParse(publishMeta)
      if (publishMeta === undefined || publishMeta === null) {
        // Nothing was ever handed to Facebook for this plan: a checked, empty answer.
        inFlight = []
        inFlightStatus = 'OK'
      } else if (metaParsed.success) {
        const now = Date.now()
        for (const post of metaParsed.data.published) receiptPostIds.add(post.post_id)
        inFlight = metaParsed.data.published
          .filter(post => {
            if (post.scheduled_publish_time === undefined) return false
            const at = Date.parse(post.scheduled_publish_time)
            return !Number.isNaN(at) && at > now
          })
          .map(post => ({
            date: post.date,
            post_id: post.post_id,
            scheduled_publish_time: post.scheduled_publish_time as string,
          }))
        inFlightStatus = 'OK'
      }
    }
  } catch {
    inFlight = []
    inFlightStatus = 'UNKNOWN'
  }

  // The publisher's own records can know about posts the receipt does not (a receipt write that failed after
  // Facebook accepted the post) and about dates whose outcome nobody has confirmed. A failed read is UNKNOWN.
  const records = await readAutoPublishRecords({
    planId: command.plan_id,
    clientId,
    dates: revoked.dates,
    receiptPostIds,
  })
  if (records.status === 'UNKNOWN') inFlightStatus = 'UNKNOWN'
  const nowMs = Date.now()
  for (const post of records.posts) {
    const at = post.scheduled_publish_time === null ? NaN : Date.parse(post.scheduled_publish_time)
    if (!Number.isNaN(at) && at > nowMs) {
      inFlight.push({ date: post.date, post_id: post.post_id, scheduled_publish_time: post.scheduled_publish_time as string })
    }
  }

  return NextResponse.json({
    success: true,
    mode: 'REVOKED',
    authorization: revoked,
    event_status: eventStatus,
    in_flight: inFlight,
    in_flight_status: inFlightStatus,
    in_flight_unconfirmed: records.unconfirmed,
    note: 'Posts already submitted to Facebook stay scheduled until they are recalled.',
  })
}
