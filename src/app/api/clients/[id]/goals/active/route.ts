/**
 * GET /api/clients/[id]/goals/active — current active goal (or null)
 */

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getActiveGoal } from '@/lib/strategy/goals'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'

export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const access = await requireDashboardClientAccess(params.id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  const goal = await getActiveGoal(supabaseAdmin, params.id)
  return NextResponse.json({ goal })
}
