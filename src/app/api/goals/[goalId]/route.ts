/**
 * GET    /api/goals/[goalId]          — read goal
 * DELETE /api/goals/[goalId]          — delete (drafts only)
 */

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { deleteDraftGoal } from '@/lib/strategy/goals'
import { requireGoalAccess } from '@/lib/strategy/auth-helpers'

export async function GET(
  _req: Request,
  { params }: { params: { goalId: string } },
) {
  const access = await requireGoalAccess(params.goalId)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })
  return NextResponse.json({ goal: access.row })
}

export async function DELETE(
  _req: Request,
  { params }: { params: { goalId: string } },
) {
  const access = await requireGoalAccess(params.goalId)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  const result = await deleteDraftGoal(supabaseAdmin, params.goalId)
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 })
  }
  return NextResponse.json({ ok: true })
}
