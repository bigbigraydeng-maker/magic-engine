/**
 * POST /api/clients/[id]/marketing-plan/[planId]/approve
 *
 * 批准 Plan：
 *   1. 把 status 从 draft → approved
 *   2. 调用 task-dispatcher 把 plan_data.tasks 批量插入 execution_items
 *   3. 返回派发结果
 *
 * 幂等性：如果 Plan 已是 approved 状态，返回当前状态，不重复派发。
 * 重试安全：派发中途失败时计划保持 draft，再点一次只会补派还没派过的任务
 * （dispatchPlanTasks 按「标题+截止日」跳过已存在的）。
 * 保证强度：应用层；两个人「同时」点批准仍可能各派一份内部待办（设计稿 §0.1，PM 已接受）。
 */

import { randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { dispatchPlanTasks, revokePlanTasks } from '@/lib/marketing-plan/task-dispatcher'
import { manualChecksOf } from '@/lib/marketing-plan/promo/board'
import { promoContentHash } from '@/lib/marketing-plan/promo/content-hash'
import { loadPromoFacts } from '@/lib/marketing-plan/promo/facts'
import { evaluateApproval } from '@/lib/marketing-plan/promo/gates'
import { hasPromoField, parsePromoSpec } from '@/lib/marketing-plan/promo/spec'
import type { ApprovalReceipt, MarketingPlan } from '@/lib/marketing-plan/types'
import { requirePlanApproverAccess } from '@/lib/auth/client-access'

export const maxDuration = 60

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string; planId: string } }
) {
  const access = await requirePlanApproverAccess(params.id)
  if (!access.ok) {
    return NextResponse.json({ success: false, error: access.error, reason: access.reason }, { status: access.status })
  }

  try {
    // 1. 读 Plan
    const { data: plan, error: fetchErr } = await supabaseAdmin
      .from('marketing_plans')
      .select('*')
      .eq('id', params.planId)
      .eq('client_id', params.id)
      .single()

    if (fetchErr) throw fetchErr
    if (!plan) {
      return NextResponse.json({ success: false, error: 'Plan not found' }, { status: 404 })
    }

    const planRow = plan as MarketingPlan

    // 2. 幂等：已批准则直接返回
    if (planRow.status === 'approved') {
      const { count } = await supabaseAdmin
        .from('execution_items')
        .select('id', { count: 'exact', head: true })
        .eq('marketing_plan_id', planRow.id)
      return NextResponse.json({
        success: true,
        plan: planRow,
        already_approved: true,
        existing_task_count: count ?? 0,
      })
    }

    // 3. 拒绝 archived/completed 状态
    if (planRow.status !== 'draft') {
      return NextResponse.json({
        success: false,
        error: `Cannot approve a plan with status="${planRow.status}". Only drafts can be approved.`,
      }, { status: 400 })
    }

    // 3b. 推广计划（plan_data.promo）：批准前先过检查清单。只看第一阶段的硬门——红或灰就不批准。
    //     后面阶段的检查只在每周对账页亮灯提醒，不阻止、也不是授权动作。
    //     没有 promo 字段的旧版计划完全不走这一步。
    let gateSnapshot: ApprovalReceipt['gate_snapshot']
    let contentHash: string | undefined
    if (hasPromoField(planRow.plan_data)) {
      const parsed = parsePromoSpec((planRow.plan_data as unknown as { promo: unknown }).promo)
      if (!parsed.ok) {
        return NextResponse.json({ success: false, error: '推广计划结构不合法，不能批准', issues: parsed.issues }, { status: 400 })
      }
      contentHash = promoContentHash(parsed.spec)
      // 批准是授权动作：预算门每次都现读最新的在投预算再判（只读；60 秒缓存使成本很小），不信最多 12 小时前的存档
      const facts = await loadPromoFacts(planRow.client_id, parsed.spec, manualChecksOf(planRow), new Date(), { liveBudget: 'always' })
      const verdict = evaluateApproval(parsed.spec, facts.gate)
      if (!verdict.can_approve) {
        return NextResponse.json({
          success: false,
          error: '检查清单有没过的硬门，暂时不能批准',
          blockers: verdict.blockers.map(b => ({ key: b.key, label: b.label, light: b.light, reason: b.reason, how: b.how, phase_id: b.phase_id, phase_name: b.phase_name })),
        }, { status: 409 })
      }
      gateSnapshot = {
        taken_at: new Date().toISOString(),
        results: verdict.results.map(r => ({
          key: r.key, light: r.light, hard: r.hard, phase_id: r.phase_id,
          // 预算那一道用的是现读还是存档、证据读于何时，事后要能说清（魏征：批准后没留「用的是哪份预算证据」）
          ...(r.source ? { source: r.source, as_of: r.as_of } : {}),
        })),
      }
    }

    // 4. 派发任务（先派发，成功后再改状态 — 防止状态改了但任务未派发）
    //    带推广结构的计划不派生成计划时附带的老任务：工作改按推广步骤手工加卡（execution 接口要求 promo_ref）。
    const isPromoPlan = hasPromoField(planRow.plan_data)
    const dispatchResult = isPromoPlan
      ? { marketing_plan_id: planRow.id, tasks_created: 0, tasks_skipped: 0, task_ids: [], packages_created: 0, package_ids: [] }
      : await dispatchPlanTasks(planRow)

    // 5. 改状态 + 写批准回执（generation_meta 保存接口不接受，不会被覆盖）
    //    派发重试时已派过的任务会被跳过（dispatch.tasks_skipped），所以这里可以放心重试。
    const approvedAt = new Date().toISOString()
    const receipt: ApprovalReceipt = {
      request_id: randomUUID(),
      approved_by: access.user.email ?? null,
      approved_at: approvedAt,
      tasks_created: dispatchResult.tasks_created,
      tasks_skipped: dispatchResult.tasks_skipped ?? 0,
      packages_created: dispatchResult.packages_created,
      ...(gateSnapshot ? { gate_snapshot: gateSnapshot } : {}),
      ...(contentHash ? { content_hash: contentHash } : {}),
    }
    const { data: updated, error: updateErr } = await supabaseAdmin
      .from('marketing_plans')
      .update({
        status: 'approved',
        approved_at: approvedAt,
        generation_meta: { ...(planRow.generation_meta ?? {}), approval_receipt: receipt },
      })
      .eq('id', params.planId)
      .eq('client_id', params.id)
      .eq('status', 'draft')
      .eq('updated_at', planRow.updated_at) // 内容在检查 / 派发期间被保存改过 → 不批准
      .select('*')
      .maybeSingle()

    if (!updateErr && !updated) {
      // 先看看是不是另一个批准请求已经赢了：赢家派的待办是对的，绝不能撤
      const { data: now } = await supabaseAdmin
        .from('marketing_plans')
        .select('status')
        .eq('id', params.planId)
        .eq('client_id', params.id)
        .maybeSingle<{ status: string }>()
      if (now?.status === 'approved') {
        return NextResponse.json({
          success: false,
          error: '这份计划刚刚已经被批准了，本次请求没有重复处理。',
        }, { status: 409 })
      }
      // 草稿在我们检查之后被改了：派发的是旧内容的任务，撤掉，让调用方重新批准
      await revokePlanTasks(params.planId, params.id)
      return NextResponse.json({
        success: false,
        error: '计划在批准过程中被修改了，已撤销本次派发，请刷新后重新批准。',
      }, { status: 409 })
    }
    if (updateErr) {
      // 任务已派发但状态没改：撤回本次派发，免得草稿计划名下留着已上看板的任务
      console.error('[marketing-plan approve] status update failed, revoking dispatch:', updateErr)
      await revokePlanTasks(params.planId, params.id)
      return NextResponse.json({
        success: false,
        error: '批准没有保存成功，已撤销本次派发，请稍后重试。',
      }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      plan: updated ?? planRow,
      dispatch: dispatchResult,
      receipt,
    })

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[marketing-plan approve] error:', message)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
