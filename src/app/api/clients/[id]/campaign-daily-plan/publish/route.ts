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
    const result = await runDailyPlanPublish({ clientId, command, approvedByUserId: access.user.id })
    return NextResponse.json(result.body, { status: result.status })
  } catch (error: unknown) {
    return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 500 })
  }
}
