/**
 * POST /api/goals/[goalId]/judge
 *
 * Body: { current_value: number, extra_summary?: string }
 *
 * Used by FDE on Goal detail page to:
 *   1. Supply the current measured value
 *   2. Compute verdict (confirmed/partial/reversed/inconclusive)
 *   3. Auto-archive the goal with verdict + summary written
 *
 * Allowed when goal status is 'active' or 'expired'.
 */

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { judgeGoalAndArchive, computeGoalVerdict } from '@/lib/strategy/verdict'
import { requireGoalAccess } from '@/lib/strategy/auth-helpers'

export async function POST(
  req: Request,
  { params }: { params: { goalId: string } },
) {
  const access = await requireGoalAccess(params.goalId)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })
  const goal = access.row

  let body: { current_value?: number; extra_summary?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (typeof body.current_value !== 'number') {
    return NextResponse.json({ error: 'current_value (number) is required' }, { status: 400 })
  }

  const result = await judgeGoalAndArchive(supabaseAdmin, {
    goal,
    current_value: body.current_value,
    extra_summary: body.extra_summary,
  })

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 })
  }

  // Return the computed verdict details for UI display
  const preview = computeGoalVerdict({
    baseline_value: goal.baseline_value,
    target_value: goal.target_value,
    current_value: body.current_value,
  })

  return NextResponse.json({
    ok: true,
    verdict: result.verdict,
    progress_pct: preview.progress_pct,
    confidence: preview.confidence,
    summary_line: preview.summary_line,
  })
}
