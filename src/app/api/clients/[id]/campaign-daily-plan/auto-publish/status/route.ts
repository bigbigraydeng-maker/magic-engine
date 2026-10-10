/**
 * GET /api/clients/[id]/campaign-daily-plan/auto-publish/status
 *
 * Read-only status for the PM-only "auto publish" section of the daily-plan
 * page. It reports whether the unattended publisher is live for this client,
 * the standing grant (if any) and every attempt the scheduler has recorded.
 *
 * Fail-closed by construction:
 *  - Only a *global* administrator (exact `ADMIN_EMAILS` match, via
 *    `isGlobalAdminEmail`) sees anything. `access.tier` is deliberately not
 *    consulted: this is a global decision. A non-admin gets a bare
 *    `{ success: true, can_manage: false }` and nothing else — no grant, no
 *    attempts, no mode — so the response cannot leak the existence of a grant
 *    or the dates it covers.
 *  - The grant's `state` is judged with the grant's own revisions by default,
 *    so a stored grant always reports `active` unless it is revoked, never
 *    activated, or expired. A caller may pass `plan_revision` and
 *    `review_revision` to ask "would this grant still be valid against the
 *    current plan?", which is the only way `plan_changed` can be reported.
 */
import { NextRequest, NextResponse } from 'next/server'

import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { isGlobalAdminEmail } from '@/lib/auth/whitelist'
import { judgeAuthorization, type AutoPublishAuthorization } from '@/lib/campaign/daily-plan-auto-publish'
import { isLiveFor, readAutoPublishSwitches } from '@/lib/campaign/daily-plan-auto-publish-decide'
import { getActiveAuthorization } from '@/lib/campaign/daily-plan-auto-publish-store'
import { listPlanAttempts } from '@/lib/campaign/daily-plan-auto-publish-status-store'

/** Live status: never let a browser or proxy reuse an old answer. */
const NO_STORE = { 'Cache-Control': 'no-store' }

const UUID_LIKE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** The grant as the status view reports it, with a computed `state`. */
interface AuthorizationStatus {
  id: string
  dates: string[]
  lifted_dates: string[]
  authorized_by_email: string
  authorized_at: string
  activated_at: string | null
  expires_at: string
  plan_revision: string
  review_revision: string
  state: 'active' | 'revoked' | 'not_activated' | 'expired' | 'plan_changed'
}

/** The attempt as the status view reports it. */
interface AttemptStatus {
  date: string
  status: string
  reason_code: string | null
  attempt_no: number
  next_retry_at: string | null
  post_id: string | null
  updated_at: string
}

function toAuthorizationStatus(
  auth: AutoPublishAuthorization,
  current: { planRevision: string; reviewRevision: string },
): AuthorizationStatus {
  const verdict = judgeAuthorization(auth, {
    planId: auth.plan_id,
    planRevision: current.planRevision,
    reviewRevision: current.reviewRevision,
    now: new Date(),
  })

  const state: AuthorizationStatus['state'] = verdict.active ? 'active' : verdict.reason.toLowerCase() as AuthorizationStatus['state']

  return {
    id: auth.id,
    dates: auth.dates,
    lifted_dates: auth.lifted_dates,
    authorized_by_email: auth.authorized_by_email,
    authorized_at: auth.authorized_at,
    activated_at: auth.activated_at,
    expires_at: auth.expires_at,
    plan_revision: auth.plan_revision,
    review_revision: auth.review_revision,
    state,
  }
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const clientId = params.id

  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ success: false, error: access.error }, { status: access.status })
  }

  // Only a global administrator may see the auto-publish status. A scoped admin
  // (DEMO_ADMINS / scoped_admin) has FDE powers inside one client, but this is a
  // global decision, so `access.tier` is not consulted here.
  if (!isGlobalAdminEmail(access.user.email ?? '') || access.allowedClientId !== null) {
    return NextResponse.json({ success: true, can_manage: false }, { headers: NO_STORE })
  }

  const planId = req.nextUrl.searchParams.get('plan_id') ?? ''
  if (!UUID_LIKE.test(planId)) {
    return NextResponse.json({ success: false, error: 'INVALID_PLAN_ID' }, { status: 400 })
  }

  const planRevisionParam = req.nextUrl.searchParams.get('plan_revision')
  const reviewRevisionParam = req.nextUrl.searchParams.get('review_revision')

  try {
    const mode = isLiveFor(
      readAutoPublishSwitches({
        DAILY_PLAN_AUTO_PUBLISH_LIVE: process.env.DAILY_PLAN_AUTO_PUBLISH_LIVE,
        DAILY_PLAN_AUTO_PUBLISH_CLIENTS: process.env.DAILY_PLAN_AUTO_PUBLISH_CLIENTS,
      }),
      clientId,
    )
      ? 'live'
      : 'practice'

    const auth = await getActiveAuthorization(planId, clientId)

    const authorization =
      auth === null
        ? null
        : toAuthorizationStatus(auth, {
            planRevision: planRevisionParam ?? auth.plan_revision,
            reviewRevision: reviewRevisionParam ?? auth.review_revision,
          })

    const attempts: AttemptStatus[] = (await listPlanAttempts(planId, clientId))
      .map(row => ({
        date: row.date,
        status: row.status,
        reason_code: row.reason_code,
        attempt_no: row.attempt_no,
        next_retry_at: row.next_retry_at,
        post_id: row.post_id,
        updated_at: row.updated_at,
      }))
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))

    return NextResponse.json({
      success: true,
      can_manage: true,
      server_now: new Date().toISOString(),
      mode,
      authorization,
      attempts,
    }, { headers: NO_STORE })
  } catch (error: unknown) {
    console.error('[auto-publish status] read failed', errorMessage(error))
    return NextResponse.json({ success: false, error: 'INTERNAL_ERROR' }, { status: 500 })
  }
}
