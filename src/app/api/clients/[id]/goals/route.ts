/**
 * GET    /api/clients/[id]/goals          — list all real goals for client
 * POST   /api/clients/[id]/goals          — create new draft goal
 */

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { createGoal, listGoalsForClient } from '@/lib/strategy/goals'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import type { CreateGoalInput, GoalStatus } from '@/types/strategy'

export async function GET(
  req: Request,
  { params }: { params: { id: string } },
) {
  const access = await requirePaidClientAccess(params.id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  const { searchParams } = new URL(req.url)
  const statusParam = searchParams.get('status')
  const statuses = statusParam
    ? (statusParam.split(',') as GoalStatus[])
    : undefined

  const goals = await listGoalsForClient(supabaseAdmin, params.id, { statuses })
  return NextResponse.json({ goals })
}

export async function POST(
  req: Request,
  { params }: { params: { id: string } },
) {
  const access = await requirePaidClientAccess(params.id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  let body: CreateGoalInput
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const result = await createGoal(supabaseAdmin, params.id, body)
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 })
  }
  return NextResponse.json({ goal: result.goal }, { status: 201 })
}
