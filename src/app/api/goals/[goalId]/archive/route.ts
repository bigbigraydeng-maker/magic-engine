/**
 * POST /api/goals/[goalId]/archive — close out an active/expired goal
 */

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { archiveGoal } from '@/lib/strategy/goals'
import { requireGoalAccess } from '@/lib/strategy/auth-helpers'

export async function POST(
  _req: Request,
  { params }: { params: { goalId: string } },
) {
  const access = await requireGoalAccess(params.goalId)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  const result = await archiveGoal(supabaseAdmin, params.goalId)
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 })
  }
  return NextResponse.json({ ok: true })
}
