/**
 * POST /api/clients/[id]/flywheel/gsc-attribution
 *
 * Triggers GSC attribution computation for all SEO flywheel actions for a client.
 * For each SEO action, finds the GSC snapshot before and after the action date,
 * computes delta (clicks, impressions, avg_position), and upserts into flywheel_outcomes.
 *
 * Body: { window_days?: number }  (default 28)
 *
 * Returns: { success, client_id, actions_found, outcomes_written, skipped, errors }
 *
 * Security: Bearer token (INTERNAL_API_KEY)
 * Reference: ROADMAP.md P17.A.4
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireBearerToken } from '@/lib/validation-utils'
import { runGscAttributionForClient } from '@/lib/flywheel/attribution/gsc-bridge'
import { requirePaidClientAccess } from '@/lib/auth/client-access'

export const dynamic = 'force-dynamic'

const DEFAULT_WINDOW_DAYS = 28
const MAX_WINDOW_DAYS     = 90

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const access = await requirePaidClientAccess(params.id)
  if (!access.ok) {
    return NextResponse.json({ success: false, error: access.error, reason: access.reason }, { status: access.status })
  }

  const auth = requireBearerToken(req.headers.get('authorization') ?? undefined)
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })
  }

  const { id: clientId } = params

  let windowDays = DEFAULT_WINDOW_DAYS
  try {
    const body = await req.json() as { window_days?: unknown }
    if (typeof body.window_days === 'number' && body.window_days > 0) {
      windowDays = Math.min(Math.round(body.window_days), MAX_WINDOW_DAYS)
    }
  } catch {
    // default stays 28
  }

  const result = await runGscAttributionForClient(clientId, windowDays)

  const hasErrors = result.errors.length > 0

  return NextResponse.json(
    {
      success:          !hasErrors || result.outcomes_written > 0,
      client_id:        result.client_id,
      actions_found:    result.actions_found,
      outcomes_written: result.outcomes_written,
      skipped:          result.skipped,
      errors:           result.errors,
    },
    { status: hasErrors && result.outcomes_written === 0 ? 502 : 200 },
  )
}
