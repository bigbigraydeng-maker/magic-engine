/**
 * POST /api/clients/[id]/campaign-daily-plan/auto-publish/confirm-unknown
 *
 * Records what really happened to a Post whose publish outcome was UNKNOWN —
 * the system could not tell whether Facebook accepted it (a timeout, a dropped
 * connection, an ambiguous provider response).
 *
 * This route exists because an UNKNOWN outcome is *never* retried
 * automatically: a blind retry could double-post, and a silent give-up could
 * lose a date. Only a human who has looked at the Page can resolve the
 * ambiguity, and this route is how that answer is recorded.
 *
 * Fail-closed by construction:
 *  - Only a *global* administrator (exact `ADMIN_EMAILS` match, via
 *    `isGlobalAdminEmail`) may confirm. `access.tier` is deliberately not
 *    consulted: resolving an ambiguous publish is a global decision.
 *  - The store only rewrites a row whose status is still `unknown_outcome`, so
 *    a stale confirmation cannot clobber a date that has since been published,
 *    tombstoned or reclaimed.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { isGlobalAdminEmail } from '@/lib/auth/whitelist'
import { confirmUnknownOutcome } from '@/lib/campaign/daily-plan-auto-publish-worker-store'

const UUID_LIKE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

const ConfirmUnknownCommandSchema = z.object({
  client_id: z.string().regex(UUID_LIKE),
  plan_id: z.string().regex(UUID_LIKE),
  date: z.string().regex(DATE_ONLY),
  outcome: z.enum(['published', 'not_published']),
})

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const clientId = params.id

  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ success: false, error: access.error }, { status: access.status })
  }

  // Only a global administrator may resolve an ambiguous publish. A scoped
  // admin (DEMO_ADMINS / scoped_admin) has FDE powers inside one client, but
  // this is a global decision, so `access.tier` is not consulted here.
  if (!isGlobalAdminEmail(access.user.email ?? '') || access.allowedClientId !== null) {
    return NextResponse.json({ success: false, error: 'GLOBAL_ADMIN_REQUIRED' }, { status: 403 })
  }

  const parsed = ConfirmUnknownCommandSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: 'INVALID_CONFIRM_COMMAND', details: parsed.error.flatten() },
      { status: 400 }
    )
  }
  const command = parsed.data
  if (command.client_id !== clientId) {
    return NextResponse.json({ success: false, error: 'CLIENT_ID_MISMATCH' }, { status: 400 })
  }

  let attempt
  try {
    attempt = await confirmUnknownOutcome({
      planId: command.plan_id,
      clientId,
      date: command.date,
      outcome: command.outcome,
      now: new Date(),
    })
  } catch (error: unknown) {
    console.error('[auto-publish confirm-unknown] confirm failed', errorMessage(error))
    return NextResponse.json({ success: false, error: 'INTERNAL_ERROR' }, { status: 500 })
  }

  if (attempt === null) {
    return NextResponse.json({ success: false, error: 'NO_UNKNOWN_OUTCOME' }, { status: 404 })
  }

  return NextResponse.json({
    success: true,
    attempt,
    note:
      command.outcome === 'published'
        ? 'Recorded as published; it will not be sent again.'
        : 'Recorded as not published; the automatic publisher may send it again at its next run.',
  })
}
