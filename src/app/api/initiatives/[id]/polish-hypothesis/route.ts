/**
 * POST /api/initiatives/[id]/polish-hypothesis
 *
 * Body: { rawHypothesis: string }
 *   → 诸葛亮 (Claude Sonnet) 润色，返回 { polished: string, cost_usd: number }
 *
 * 仅返回润色结果，不直接落库。FDE 可以选择采纳后再 PATCH 该 initiative。
 */

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getGoalById } from '@/lib/strategy/goals'
import { polishHypothesis } from '@/lib/strategy/hypothesis-polish'
import { requireInitiativeAccess } from '@/lib/strategy/auth-helpers'

export async function POST(
  req: Request,
  { params }: { params: { id: string } },
) {
  const access = await requireInitiativeAccess(params.id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })
  const initiative = access.row

  let body: { rawHypothesis?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const rawHypothesis = body.rawHypothesis?.trim()
  if (!rawHypothesis) {
    return NextResponse.json({ error: 'rawHypothesis is required' }, { status: 400 })
  }

  const goal = await getGoalById(supabaseAdmin, initiative.goal_id)
  if (!goal) return NextResponse.json({ error: 'Goal not found' }, { status: 404 })

  // Load client for context
  const { data: client } = await supabaseAdmin
    .from('clients')
    .select('name, industry, city')
    .eq('id', initiative.client_id)
    .maybeSingle<{ name: string; industry: string | null; city: string | null }>()

  const result = await polishHypothesis({
    goal: {
      intent: goal.intent,
      title: goal.title,
      primary_metric_label: goal.primary_metric_label,
      baseline_value: goal.baseline_value,
      target_value: goal.target_value,
      primary_metric_unit: goal.primary_metric_unit,
      period_start: goal.period_start,
      period_end: goal.period_end,
      fde_reasoning: goal.fde_reasoning,
    },
    initiative: {
      initiative_type: initiative.initiative_type,
      title: initiative.title,
      posture: initiative.posture,
      budget_percent: initiative.budget_percent,
      budget_amount: initiative.budget_amount,
      budget_currency: goal.budget_currency,
    },
    rawHypothesis,
    clientName: client?.name ?? '(unknown client)',
    clientIndustry: client?.industry ?? null,
    clientCity: client?.city ?? null,
  })

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 })
  }

  return NextResponse.json({
    polished: result.polished,
    cost_usd: result.cost_usd,
  })
}
