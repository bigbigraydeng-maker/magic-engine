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
import { isMissingTableError, listFreshClaims } from '@/lib/campaign/daily-plan-auto-publish-worker-store'

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
      const claims = await listFreshClaims(command.plan_id, clientId, new Date(Date.now() - AUTO_PUBLISH_CLAIM_FRESH_MS)).catch(error => {
        if (isMissingTableError(error)) return []
        throw error
      })
      const busy = claims.filter(claim => !command.dates || command.dates.includes(claim.date)).map(claim => claim.date)
      if (busy.length > 0) {
        return NextResponse.json(
          { success: false, error: 'AUTO_PUBLISH_IN_PROGRESS', dates: busy, hint: '自动发布正在处理这些日期，等几分钟后再试。' },
          { status: 409 }
        )
      }
    }
    const result = await runDailyPlanPublish({ clientId, command, approvedByUserId: access.user.id })
    return NextResponse.json(result.body, { status: result.status })
  } catch (error: unknown) {
    return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 500 })
  }
}
