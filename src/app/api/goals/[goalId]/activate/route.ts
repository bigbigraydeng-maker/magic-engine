/**
 * POST /api/goals/[goalId]/activate — flip draft → active (one active per client)
 */

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { activateGoal } from '@/lib/strategy/goals'
import { requireGoalAccess } from '@/lib/strategy/auth-helpers'

export async function POST(
  _req: Request,
  { params }: { params: { goalId: string } },
) {
  const access = await requireGoalAccess(params.goalId)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  const result = await activateGoal(supabaseAdmin, params.goalId)
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 })
  }
  return NextResponse.json({ ok: true })
}
