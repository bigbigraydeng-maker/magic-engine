/**
 * GET /api/goals/[goalId]/execution-summary  [Phase 33 M4 / P33.11 + P33.12]
 *
 * Aggregates execution progress for a Goal:
 *   - Per-Initiative: campaign count (real, dead-id filtered) + campaign status
 *     breakdown + action counts by status + completion %
 *   - Goal-level totals: N initiatives / X real campaigns / Y completed actions /
 *     Z in-progress actions + aggregate completion %
 *
 * Returned in one trip so the Goal detail page can render the summary bar +
 * per-card details without N front-end fetches.
 *
 * Auth: session-cookie via requireGoalAccess (Phase 19 pattern).
 */

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getExecutionSummaryForGoal } from '@/lib/strategy/initiatives'
import { requireGoalAccess } from '@/lib/strategy/auth-helpers'

export async function GET(
  _req: Request,
  { params }: { params: { goalId: string } },
) {
  const access = await requireGoalAccess(params.goalId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const summary = await getExecutionSummaryForGoal(supabaseAdmin, params.goalId)
  if (!summary) {
    return NextResponse.json({ error: 'Failed to load execution summary' }, { status: 500 })
  }
  return NextResponse.json({ summary })
}
