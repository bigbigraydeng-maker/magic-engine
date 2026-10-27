/**
 * GET /api/clients/[id]/marketing-plan/[planId]/promo — 推广计划「一页纸」（只读：灯 + 对账）+ 填表用的下拉选项
 * PUT /api/clients/[id]/marketing-plan/[planId]/promo — 保存推广计划结构（只有草稿可以改）
 *
 * 设计稿 docs/specs/2026-10-14-promo-plan-board-design-v0.1.md。
 * 保存时的服务端校验（不信前端）：结构合法；目标属于同一客户；广告账户属于同一客户；
 * 广告日预算按账户汇总后没有确定超限（读不到上限只是"未核实"，批准时由检查清单挡住）。
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { rejectAgentAdsBearer } from '@/lib/auth/agent-ads-guard'
import { requirePaidClientAccess, requirePlanApproverAccess } from '@/lib/auth/client-access'
import { buildPromoBoard } from '@/lib/marketing-plan/promo/board'
import { loadGoal, loadLatestClientPrescription, loadLatestGoalPrescription, loadPromoFacts } from '@/lib/marketing-plan/promo/facts'
import type { GoalPrescriptionView } from '@/lib/marketing-plan/promo/goal-prescription'
import { planLinkedGoalId } from '@/lib/marketing-plan/promo/plan-pick'
import { loadLiveAds } from '@/lib/marketing-plan/promo/live-ads'
import { loadPromoOptions } from '@/lib/marketing-plan/promo/options'
import { allAdsSteps, type PromoSpec, type PromoValidationIssue } from '@/lib/marketing-plan/promo/spec'
import { validatePlanDraft } from '@/lib/marketing-plan/promo/plan-draft-validate'
import { isPlanContentLocked, PLAN_CONTENT_LOCKED_MESSAGE } from '@/lib/marketing-plan/plan-guard'
import type { MarketingPlan } from '@/lib/marketing-plan/types'

type Ctx = { params: { id: string; planId: string } }

function loadPlanPrescription(clientId: string, goalId: string): Promise<GoalPrescriptionView | null> {
  const load = goalId !== ''
    ? loadLatestGoalPrescription(clientId, goalId)
    : loadLatestClientPrescription(clientId)
  return load.catch((err: unknown) => {
    console.warn('[promo] 处方没读到', err instanceof Error ? err.message : err)
    return null
  })
}

async function loadPlan(ctx: Ctx): Promise<MarketingPlan | null> {
  const { data } = await supabaseAdmin
    .from('marketing_plans')
    .select('*')
    .eq('id', ctx.params.planId)
    .eq('client_id', ctx.params.id)
    .maybeSingle<MarketingPlan>()
  return data
}

export async function GET(_req: NextRequest, ctx: Ctx) {
  const denied = await rejectAgentAdsBearer(_req, { clientId: ctx.params.id, action: 'outside_allowlist' })
  if (denied) return denied
  const access = await requirePaidClientAccess(ctx.params.id)
  if (!access.ok) return NextResponse.json({ success: false, error: access.error, reason: access.reason }, { status: access.status })
  try {
    const plan = await loadPlan(ctx)
    if (!plan) return NextResponse.json({ success: false, error: 'Plan not found' }, { status: 404 })
    const goalId = planLinkedGoalId(plan)
    // 下拉选项只有草稿填表才用；读不到时页面照常显示（选项为空，表格里会提示）
    const [board, options, liveAds, prescription] = await Promise.all([
      // 页面上的「批准」按钮是否可点由这份清单决定，所以预算门存档过期 / 没过时要现读（不然晚上永远灰、点不了）
      buildPromoBoard(plan, new Date(), { liveBudget: 'if_needed' }),
      plan.status === 'draft' ? loadPromoOptions(ctx.params.id).catch(() => null) : Promise.resolve(null),
      // 只在计划还没批准、且是管理员账号时才读（FDE 按付费客户处理，不返回）：账户编号、标签、花费是内部口径，付费客户账号不给。
      // 数据来自快照表（每 6 小时抓一次）和日花费表（次日才到），读不到时回 ok:false。
      plan.status === 'draft' && access.tier === 'admin' ? loadLiveAds(ctx.params.id) : Promise.resolve(null),
      // 推广表单或空白草稿上的目标 → 该目标最新一版。都没有 → 客户最近一份还在用的处方。
      loadPlanPrescription(ctx.params.id, goalId),
    ])
    return NextResponse.json({ success: true, board, options, live_ads: liveAds, live_ads_visible: access.tier === 'admin', prescription })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}

function shapeError(issues: PromoValidationIssue[]): NextResponse {
  return NextResponse.json({ success: false, error: '推广计划结构不合法', issues }, { status: 400 })
}

function budgetError(problems: string[]): NextResponse {
  return NextResponse.json({ success: false, error: '广告预算或账户不符合要求', problems }, { status: 400 })
}

/** Shape first. Empty accounts would false-reject a real ad account, so that case is rechecked later. */
function openedSpec(raw: unknown): { ok: true; spec: PromoSpec } | { ok: false; response: NextResponse } {
  const preview = validatePlanDraft(raw, { accounts: [], clientCapCents: null })
  if (preview.ok) return { ok: true, spec: preview.spec }
  if (preview.code === 'invalid_spec') return { ok: false, response: shapeError(preview.issues) }
  if (allAdsSteps(preview.spec).length === 0) return { ok: false, response: budgetError(preview.problems) }
  return { ok: true, spec: preview.spec }
}

export async function PUT(req: NextRequest, ctx: Ctx) {
  const denied = await rejectAgentAdsBearer(req, {
    clientId: ctx.params.id,
    action: 'change_budget',
    resourceId: ctx.params.planId,
  })
  if (denied) return denied
  const access = await requirePlanApproverAccess(ctx.params.id)
  if (!access.ok) return NextResponse.json({ success: false, error: access.error, reason: access.reason }, { status: access.status })
  try {
    const body = (await req.json().catch(() => null)) as { promo?: unknown; expected_updated_at?: string } | null
    const opened = openedSpec(body?.promo)
    if (!opened.ok) return opened.response
    let spec = opened.spec

    const plan = await loadPlan(ctx)
    if (!plan) return NextResponse.json({ success: false, error: 'Plan not found' }, { status: 404 })
    // 乐观锁：前端带上读到的 updated_at，若已被别处改过就拒绝，避免覆盖别人的修改
    if (typeof body?.expected_updated_at === 'string' && body.expected_updated_at !== '' && body.expected_updated_at !== plan.updated_at) {
      return NextResponse.json({ success: false, error: '这份计划刚刚在别处被改过，这次保存没有生效。请刷新页面后再试。' }, { status: 409 })
    }
    if (isPlanContentLocked(plan.status)) {
      return NextResponse.json({ success: false, error: PLAN_CONTENT_LOCKED_MESSAGE }, { status: 409 })
    }
    if (plan.status !== 'draft') {
      return NextResponse.json({ success: false, error: '只有草稿计划可以保存推广计划结构' }, { status: 409 })
    }

    // 目标必须属于同一个客户（否则可以挂别家的目标、读到别家的目标值）
    if ((await loadGoal(ctx.params.id, spec.goal_id)) === null) {
      return NextResponse.json({ success: false, error: '目标不存在或不属于这个客户' }, { status: 400 })
    }

    // 广告账户归属 + 确定的超限（读不到只是未核实，不在这里拒绝）
    if (allAdsSteps(spec).length > 0) {
      const facts = await loadPromoFacts(ctx.params.id, spec, plan.generation_meta?.promo_checks ?? [])
      const verdict = validatePlanDraft(body?.promo, {
        accounts: facts.gate.accounts,
        clientCapCents: facts.gate.config?.daily_budget_cap_cents ?? null,
      })
      if (!verdict.ok && verdict.code === 'invalid_spec') return shapeError(verdict.issues)
      if (!verdict.ok) return budgetError(verdict.problems)
      spec = verdict.spec
    }

    const nextPlanData = { ...(plan.plan_data as unknown as Record<string, unknown>), promo: spec }
    const { data, error } = await supabaseAdmin
      .from('marketing_plans')
      .update({ plan_data: nextPlanData })
      .eq('id', ctx.params.planId)
      .eq('client_id', ctx.params.id)
      .eq('status', 'draft') // 保存瞬间计划仍是草稿（防和批准并发）
      .eq('updated_at', plan.updated_at) // 读完到写入之间被别处改过 → 不覆盖
      .select('*')
      .maybeSingle()
    if (error) throw error
    if (!data) {
      return NextResponse.json({ success: false, error: '这份计划刚刚在别处被改过，这次保存没有生效。请刷新页面后再试。' }, { status: 409 })
    }
    return NextResponse.json({ success: true, plan: data })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
