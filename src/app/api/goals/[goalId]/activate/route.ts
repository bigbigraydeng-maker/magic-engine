/**
 * POST /api/goals/[goalId]/activate — flip draft → active (one active per client)
 */

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { activateGoal } from '@/lib/strategy/goals'

export async function POST(
  _req: Request,
  { params }: { params: { goalId: string } },
) {
  const result = await activateGoal(supabaseAdmin, params.goalId)
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 })
  }
  return NextResponse.json({ ok: true })
}
