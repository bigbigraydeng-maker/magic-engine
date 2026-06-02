/**
 * GET    /api/goals/[goalId]          — read goal
 * DELETE /api/goals/[goalId]          — delete (drafts only)
 */

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getGoalById, deleteDraftGoal } from '@/lib/strategy/goals'

export async function GET(
  _req: Request,
  { params }: { params: { goalId: string } },
) {
  const goal = await getGoalById(supabaseAdmin, params.goalId)
  if (!goal) return NextResponse.json({ error: 'Goal not found' }, { status: 404 })
  return NextResponse.json({ goal })
}

export async function DELETE(
  _req: Request,
  { params }: { params: { goalId: string } },
) {
  const result = await deleteDraftGoal(supabaseAdmin, params.goalId)
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 })
  }
  return NextResponse.json({ ok: true })
}
