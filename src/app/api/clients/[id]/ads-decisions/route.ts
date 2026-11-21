/**
 * List and create ads_decision_v1 entries (FDE/PM operator access).
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireOperatorAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'
import { ADS_ACTION_TYPE } from '@/lib/flywheel/vocabulary'
import { readAdsDecisionV1, insertDecisionLogRow } from '@/lib/ads/decision-log/persist'
import { buildManualDecision } from '@/lib/ads/decision-log/manual-entry'

type Params = { params: { id: string } }

export async function GET(_req: NextRequest, { params }: Params) {
  const gate = await requireOperatorAccess(params.id)
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status })
  }
  const { data, error } = await supabaseAdmin
    .from('flywheel_actions')
    .select('id, created_at, payload, action_type')
    .eq('client_id', params.id)
    .eq('flywheel', 'ads')
    .eq('action_type', ADS_ACTION_TYPE.DECISION_LOG)
    .order('created_at', { ascending: false })
    .limit(40)
  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
  const items = (data ?? []).flatMap((row) => {
    if (typeof row.id !== 'string') return []
    const decision = readAdsDecisionV1(row.payload)
    if (!decision) return []
    return [{
      action_id: row.id,
      decided_at: decision.decided_at,
      subject_label: decision.subject.label_zh,
      what_done_zh: decision.what_done_zh,
      status: decision.status,
      review_due_on: decision.review_due_on,
      review_verdict: decision.review_result?.verdict ?? null,
      review_reason_zh: decision.review_result?.reason_zh ?? null,
    }]
  })
  return NextResponse.json({ success: true, items })
}

interface CreateBody {
  subject_level?: string
  subject_ref?: string
  subject_label?: string
  decision_type?: string
  what_done_zh?: string
  reasoning_zh?: string
  stop_or_rollback_zh?: string
  review_horizon_days?: number
  no_action?: boolean
  entity_refs?: string[]
  agent_draft?: boolean
}

export async function POST(req: NextRequest, { params }: Params) {
  const gate = await requireOperatorAccess(params.id)
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status })
  }
  const body = (await req.json().catch(() => ({}))) as CreateBody
  const label = text(body.subject_label) ?? '广告对象'
  const ref = text(body.subject_ref) ?? 'manual-subject'
  const level = parseLevel(body.subject_level)
  const what = text(body.what_done_zh)
    ?? (body.no_action ? '本日决定不调整广告' : null)
  const reasoning = text(body.reasoning_zh) ?? '未填写原因'
  if (!what) {
    return NextResponse.json({ success: false, error: '请写清楚做了什么，或勾选「本日不动作」。' }, { status: 400 })
  }
  const horizon = whole(body.review_horizon_days, 1, 28) ?? 3
  const email = (gate.user.email ?? 'fde').trim()
  const decision = buildManualDecision({
    subjectLevel: level,
    subjectRef: ref,
    subjectLabel: label,
    decisionType: body.no_action ? 'no_action' : (text(body.decision_type) ?? 'execute'),
    whatDoneZh: what,
    reasoningZh: reasoning,
    stopOrRollbackZh: text(body.stop_or_rollback_zh) ?? '按广告门日常规则继续观察。',
    reviewHorizonDays: horizon,
    decidedByLabel: email,
    status: body.agent_draft ? 'pending_confirm' : 'active',
    entityRefsForCtr: Array.isArray(body.entity_refs)
      ? body.entity_refs.filter((v): v is string => typeof v === 'string' && v.length > 0)
      : undefined,
    expectationNotesZh: body.no_action ? undefined : '人工录入预期，回头看按日表核对。',
  }, new Date().toISOString())
  const actionId = await insertDecisionLogRow(supabaseAdmin, params.id, decision)
  if (!actionId) {
    return NextResponse.json({ success: false, error: '决策没能记下，请重试。' }, { status: 500 })
  }
  return NextResponse.json({ success: true, action_id: actionId, status: decision.status })
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function whole(value: unknown, min: number, max: number): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) return null
  return value
}

function parseLevel(value: unknown): 'campaign' | 'adset' | 'ad' | 'account' {
  if (value === 'campaign' || value === 'ad' || value === 'account' || value === 'adset') return value
  return 'adset'
}
