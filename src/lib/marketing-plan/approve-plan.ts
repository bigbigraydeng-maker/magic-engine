/**
 * Approve a draft marketing plan. One implementation for the approve route and
 * for "agree on a prescription" (the plan rides along only when every hard
 * check is green). It only changes plan state and dispatches internal to-dos
 * for legacy plans: no Meta draft, no Meta write, no spend, no budget change.
 */

import { randomUUID } from 'crypto'
import { supabaseAdmin } from '@/lib/supabase'
import { dispatchPlanTasks, revokePlanTasks } from '@/lib/marketing-plan/task-dispatcher'
import { manualChecksOf } from '@/lib/marketing-plan/promo/board'
import { promoContentHash } from '@/lib/marketing-plan/promo/content-hash'
import { loadPromoFacts } from '@/lib/marketing-plan/promo/facts'
import { evaluateApproval, type GateResult } from '@/lib/marketing-plan/promo/gates'
import { hardNotGreen } from '@/lib/marketing-plan/approve-plan-gates'
import { hasPromoField, parsePromoSpec, type PromoValidationIssue } from '@/lib/marketing-plan/promo/spec'
import type { ApprovalReceipt, MarketingPlan } from '@/lib/marketing-plan/types'

type Dispatch = Awaited<ReturnType<typeof dispatchPlanTasks>>

export type ApprovePlanResult =
  | { kind: 'approved'; plan: MarketingPlan; dispatch: Dispatch; receipt: ApprovalReceipt }
  | { kind: 'already_approved'; plan: MarketingPlan; existingTaskCount: number }
  | { kind: 'not_found' }
  | { kind: 'not_draft'; status: string }
  | { kind: 'invalid_spec'; issues: PromoValidationIssue[] }
  | { kind: 'blocked'; blockers: GateResult[] }
  /** Only with `requireAllGreen`: gates pass but not every hard check is green. Nothing was written. */
  | { kind: 'needs_confirmation'; planStart: string; planEnd: string; checks: GateResult[] }
  | { kind: 'conflict'; error: string; status: 409 | 500 }

async function existingTaskCount(planId: string): Promise<number> {
  const { count } = await supabaseAdmin
    .from('execution_items')
    .select('id', { count: 'exact', head: true })
    .eq('marketing_plan_id', planId)
  return count ?? 0
}

interface Gated {
  snapshot?: ApprovalReceipt['gate_snapshot']
  hash?: string
}

async function runGates(
  plan: MarketingPlan,
  requireAllGreen: boolean,
): Promise<{ stop: ApprovePlanResult } | { gated: Gated }> {
  if (!hasPromoField(plan.plan_data)) return { gated: {} }
  const parsed = parsePromoSpec((plan.plan_data as unknown as { promo: unknown }).promo)
  if (!parsed.ok) return { stop: { kind: 'invalid_spec', issues: parsed.issues } }
  // Approval is an authorizing action: the budget gate always reads live.
  const facts = await loadPromoFacts(plan.client_id, parsed.spec, manualChecksOf(plan), new Date(), { liveBudget: 'always' })
  const verdict = evaluateApproval(parsed.spec, facts.gate)
  if (!verdict.can_approve) return { stop: { kind: 'blocked', blockers: verdict.blockers } }
  const notGreen = hardNotGreen(verdict)
  if (requireAllGreen && notGreen.length > 0) {
    return { stop: { kind: 'needs_confirmation', planStart: plan.start_date, planEnd: plan.end_date, checks: notGreen } }
  }
  return {
    gated: {
      hash: promoContentHash(parsed.spec),
      snapshot: {
        taken_at: new Date().toISOString(),
        results: verdict.results.map(r => ({
          key: r.key, light: r.light, hard: r.hard, phase_id: r.phase_id,
          ...(r.source ? { source: r.source, as_of: r.as_of } : {}),
        })),
      },
    },
  }
}

async function loseRace(planId: string, clientId: string): Promise<ApprovePlanResult> {
  const { data: now } = await supabaseAdmin
    .from('marketing_plans')
    .select('status')
    .eq('id', planId)
    .eq('client_id', clientId)
    .maybeSingle<{ status: string }>()
  if (now?.status === 'approved') {
    // The winner's dispatched to-dos are correct; never revoke them.
    return { kind: 'conflict', status: 409, error: '这份计划刚刚已经被批准了，本次请求没有重复处理。' }
  }
  await revokePlanTasks(planId, clientId)
  return { kind: 'conflict', status: 409, error: '计划在批准过程中被修改了，已撤销本次派发，请刷新后重新批准。' }
}

export async function approvePlan(args: {
  clientId: string
  planId: string
  approvedBy: string | null
  requireAllGreen?: boolean
}): Promise<ApprovePlanResult> {
  const { data, error: fetchErr } = await supabaseAdmin
    .from('marketing_plans')
    .select('*')
    .eq('id', args.planId)
    .eq('client_id', args.clientId)
    .single()
  if (fetchErr) throw fetchErr
  if (!data) return { kind: 'not_found' }
  const plan = data as MarketingPlan

  if (plan.status === 'approved') {
    return { kind: 'already_approved', plan, existingTaskCount: await existingTaskCount(plan.id) }
  }
  if (plan.status !== 'draft') return { kind: 'not_draft', status: plan.status }

  const gates = await runGates(plan, args.requireAllGreen === true)
  if ('stop' in gates) return gates.stop

  // Dispatch first, flip the status after: a failed flip revokes the dispatch.
  // Plans with a promo structure do not dispatch legacy plan tasks.
  const dispatch: Dispatch = hasPromoField(plan.plan_data)
    ? { marketing_plan_id: plan.id, tasks_created: 0, tasks_skipped: 0, task_ids: [], packages_created: 0, package_ids: [] }
    : await dispatchPlanTasks(plan)

  const approvedAt = new Date().toISOString()
  const receipt: ApprovalReceipt = {
    request_id: randomUUID(),
    approved_by: args.approvedBy,
    approved_at: approvedAt,
    tasks_created: dispatch.tasks_created,
    tasks_skipped: dispatch.tasks_skipped ?? 0,
    packages_created: dispatch.packages_created,
    ...(gates.gated.snapshot ? { gate_snapshot: gates.gated.snapshot } : {}),
    ...(gates.gated.hash ? { content_hash: gates.gated.hash } : {}),
  }
  const { data: updated, error: updateErr } = await supabaseAdmin
    .from('marketing_plans')
    .update({
      status: 'approved',
      approved_at: approvedAt,
      generation_meta: { ...(plan.generation_meta ?? {}), approval_receipt: receipt },
    })
    .eq('id', args.planId)
    .eq('client_id', args.clientId)
    .eq('status', 'draft')
    .eq('updated_at', plan.updated_at) // saved during checks/dispatch → do not approve
    .select('*')
    .maybeSingle()

  if (!updateErr && !updated) return loseRace(args.planId, args.clientId)
  if (updateErr) {
    console.error('[marketing-plan approve] status update failed, revoking dispatch:', updateErr)
    await revokePlanTasks(args.planId, args.clientId)
    return { kind: 'conflict', status: 500, error: '批准没有保存成功，已撤销本次派发，请稍后重试。' }
  }
  return { kind: 'approved', plan: (updated as MarketingPlan | null) ?? plan, dispatch, receipt }
}
