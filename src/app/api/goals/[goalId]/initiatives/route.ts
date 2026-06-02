/**
 * GET  /api/goals/[goalId]/initiatives — list initiatives under goal
 * POST /api/goals/[goalId]/initiatives — create new initiative
 */

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { listInitiativesForGoal, createInitiative } from '@/lib/strategy/initiatives'
import { requireGoalAccess } from '@/lib/strategy/auth-helpers'
import type { CreateInitiativeInput } from '@/types/strategy'

export async function GET(
  _req: Request,
  { params }: { params: { goalId: string } },
) {
  const access = await requireGoalAccess(params.goalId)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  const initiatives = await listInitiativesForGoal(supabaseAdmin, params.goalId)
  return NextResponse.json({ initiatives })
}

export async function POST(
  req: Request,
  { params }: { params: { goalId: string } },
) {
  const access = await requireGoalAccess(params.goalId)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  let body: Omit<CreateInitiativeInput, 'goal_id'>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const result = await createInitiative(supabaseAdmin, { ...body, goal_id: params.goalId })
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 })
  }
  return NextResponse.json({ initiative: result.initiative }, { status: 201 })
}
