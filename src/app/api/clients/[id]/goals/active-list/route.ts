/**
 * GET /api/clients/[id]/goals/active-list — Phase 32
 *
 * Returns ALL active goals for a client (newest first).
 * Use this when you need the multi-Goal view (banner, dashboard).
 *
 * Use `/active` (singular) for backwards-compat single-goal callers.
 */

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { listActiveGoals } from '@/lib/strategy/goals'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'

export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const access = await requireDashboardClientAccess(params.id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  const goals = await listActiveGoals(supabaseAdmin, params.id)
  return NextResponse.json({ goals, count: goals.length })
}
