/**
 * GET    /api/goals/[goalId]          — read goal
 * PATCH  /api/goals/[goalId]          — set the reason on a draft
 * DELETE /api/goals/[goalId]          — delete (drafts only)
 */

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { deleteDraftGoal, updateDraftGoalReason } from '@/lib/strategy/goals'
import { requireGoalAccess } from '@/lib/strategy/auth-helpers'

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

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  if (!isReasonOnlyBody(body)) {
    return NextResponse.json({ error: 'Only fde_reasoning can be updated' }, { status: 400 })
  }

  const result = await updateDraftGoalReason(supabaseAdmin, params.goalId, body.fde_reasoning)
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 })
  }
  return NextResponse.json({ goal: result.goal })
}

function isReasonOnlyBody(body: unknown): body is { fde_reasoning: unknown } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return false
  const keys = Object.keys(body)
  return keys.length === 1 && keys[0] === 'fde_reasoning'
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
