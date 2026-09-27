/**
 * GET    /api/goals/[goalId]          — read goal
 * PATCH  /api/goals/[goalId]          — update recurrence (only settable field today)
 * DELETE /api/goals/[goalId]          — delete (drafts only)
 */

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { deleteDraftGoal, setGoalRecurrence } from '@/lib/strategy/goals'
import { requireGoalAccess } from '@/lib/strategy/auth-helpers'
import type { GoalRecurrence } from '@/types/strategy'

export async function GET(
  _req: Request,
  { params }: { params: { goalId: string } },
) {
  const access = await requireGoalAccess(params.goalId)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })
  return NextResponse.json({ goal: access.row })
}

export async function PATCH(
  req: Request,
  { params }: { params: { goalId: string } },
) {
  const access = await requireGoalAccess(params.goalId)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  let body: { recurrence?: GoalRecurrence }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (body.recurrence !== 'monthly' && body.recurrence !== null) {
    return NextResponse.json({ error: "recurrence must be 'monthly' or null" }, { status: 400 })
  }

  const result = await setGoalRecurrence(supabaseAdmin, params.goalId, body.recurrence)
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 })
  }
  return NextResponse.json({ ok: true })
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
