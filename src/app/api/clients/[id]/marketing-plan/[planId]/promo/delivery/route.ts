/**
 * PATCH /api/clients/[id]/marketing-plan/[planId]/promo/delivery
 *
 * 只改这个客户当前那一份已批准计划的投放阶段（plan_data.promo.delivery）。
 * 允许：任何阶段或还没标 → 稳住；稳住 → 试投。
 * 放量不走这里。放量要更多预算，只能另起草稿：POST .../promo/stage-proposal。
 * 不改每天总上限、不改步骤预算、不改其他字段，也不调用广告后台。
 */
import { NextRequest, NextResponse } from 'next/server'
import { rejectAgentAdsBearer } from '@/lib/auth/agent-ads-guard'
import { requirePlanApproverAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'
import {
  auditRow, markAllowed, nextDelivery, planDataWithDelivery, readStageRequest, refusedMark, sameExceptDelivery,
  type MarkStage,
} from '@/lib/marketing-plan/promo/delivery-mark'
import { pickCurrentApprovedPlan, type PlanRow } from '@/lib/marketing-plan/promo/live-ad-link'
import { readPromoSpec } from '@/lib/marketing-plan/promo/spec'
import { todayInNz } from '@/lib/marketing-plan/promo/schedule-view'
import { readSupersededBy } from '@/lib/marketing-plan/promo/supersede-prior-approved'
import type { MarketingPlan } from '@/lib/marketing-plan/types'

type Params = { id: string; planId: string }
const NOT_LIVE = '只有正在执行的计划可以改阶段。草稿和已归档的计划不能从这里改。'
const NOT_CURRENT = '这不是这个客户正在执行的那一份计划。'

function json(status: number, error: string, reason?: string): NextResponse {
  return NextResponse.json({ success: false, error, ...(reason ? { reason } : {}) }, { status })
}

export async function PATCH(req: NextRequest, { params }: { params: Params }) {
  const denied = await rejectAgentAdsBearer(req, { clientId: params.id, action: 'outside_allowlist' })
  if (denied) return denied
  const access = await requirePlanApproverAccess(params.id)
  if (!access.ok) return json(access.status, access.error, access.reason)
  const requested = readStageRequest(await req.json().catch(() => null))
  if (!requested.ok) return json(requested.status, requested.error)
  const email = access.user.email ?? ''
  if (email === '') return json(403, '看不出是谁在改阶段，没有改。')
  try {
    return await applyMark(params, email, requested.stage)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return json(500, message)
  }
}

async function applyMark(params: Params, email: string, stage: MarkStage): Promise<NextResponse> {
  const plan = await loadPlan(params)
  if (!plan) return json(404, '找不到这份计划')
  if (plan.status !== 'approved') return json(409, NOT_LIVE)
  if (await currentApprovedId(params.id) !== plan.id) return json(409, NOT_CURRENT)
  const spec = readPromoSpec(plan.plan_data)
  if (!spec) return json(409, '这份计划没有推广结构，不能只改阶段。')
  const from = spec.delivery?.stage ?? null
  if (!markAllowed(from, stage)) return json(409, refusedMark())
  const previous = plan.plan_data
  const next = planDataWithDelivery(previous, nextDelivery(spec.delivery, stage, todayInNz()))
  if (next === null || !sameExceptDelivery(previous, next)) {
    return json(500, '阶段没有改。预算和上限保持原样。')
  }
  if (typeof plan.updated_at !== 'string' || plan.updated_at === '') {
    return json(409, '这份计划刚刚在别处被改过，这次没有改阶段。请刷新后再试。')
  }
  if (!await saveDelivery(params, plan.updated_at, next)) {
    return json(409, '这份计划刚刚在别处被改过，这次没有改阶段。请刷新后再试。')
  }
  if (await writeAudit(params, from, stage, email)) return NextResponse.json({ success: true, stage })
  await restoreDelivery(params, previous)
  return json(500, '阶段没有记下。请刷新后再看，预算和上限没有改。')
}

async function loadPlan(params: Params): Promise<MarketingPlan | null> {
  const { data, error } = await supabaseAdmin.from('marketing_plans').select('*')
    .eq('id', params.planId).eq('client_id', params.id).maybeSingle<MarketingPlan>()
  if (error) throw error
  return data
}

async function currentApprovedId(clientId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin.from('marketing_plans')
    .select('id, title, status, approved_at, generation_meta')
    .eq('client_id', clientId).eq('status', 'approved')
  if (error) throw error
  const rows = (Array.isArray(data) ? data : []).flatMap(toPlanRow)
  return pickCurrentApprovedPlan(rows)?.id ?? null
}

function toPlanRow(raw: unknown): PlanRow[] {
  if (!raw || typeof raw !== 'object') return []
  const row = raw as {
    id?: unknown
    title?: unknown
    status?: unknown
    approved_at?: unknown
    generation_meta?: MarketingPlan['generation_meta']
  }
  if (typeof row.id !== 'string' || row.id === '') return []
  return [{
    id: row.id,
    title: typeof row.title === 'string' ? row.title : '',
    status: typeof row.status === 'string' ? row.status : '',
    approvedAt: typeof row.approved_at === 'string' ? row.approved_at : null,
    superseded: readSupersededBy(row.generation_meta ?? null) !== null,
  }]
}

async function saveDelivery(params: Params, updatedAt: string, planData: unknown): Promise<boolean> {
  const { data, error } = await supabaseAdmin.from('marketing_plans').update({ plan_data: planData })
    .eq('id', params.planId).eq('client_id', params.id).eq('status', 'approved').eq('updated_at', updatedAt)
    .select('id').maybeSingle()
  if (error) throw error
  return Boolean((data as { id?: string } | null)?.id)
}

async function restoreDelivery(params: Params, planData: unknown): Promise<void> {
  await supabaseAdmin.from('marketing_plans').update({ plan_data: planData })
    .eq('id', params.planId).eq('client_id', params.id).eq('status', 'approved')
}

async function writeAudit(params: Params, from: 'test' | 'scale' | 'steady' | null, stage: MarkStage, email: string): Promise<boolean> {
  const { error } = await supabaseAdmin.from('flywheel_actions').insert(auditRow({
    clientId: params.id, planId: params.planId, from, to: stage, by: email, at: new Date().toISOString(),
  }))
  return !error
}
