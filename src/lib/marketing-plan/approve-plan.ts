/**
 * Approve a draft marketing plan. One implementation for the approve route and
 * for "agree on a prescription" (the plan rides along only when every
 * applicable check, on every phase, is green). It only changes plan state
 * and dispatches internal to-dos for legacy plans: no Meta draft, no Meta
 * write, no spend, no budget change.
 */

import { randomUUID } from 'crypto'
import { supabaseAdmin } from '@/lib/supabase'
import { dispatchPlanTasks, revokePlanTasks } from '@/lib/marketing-plan/task-dispatcher'
import { manualChecksOf } from '@/lib/marketing-plan/promo/board'
import { promoContentHash } from '@/lib/marketing-plan/promo/content-hash'
import { loadPromoFacts } from '@/lib/marketing-plan/promo/facts'
import { evaluateApproval, type GateResult } from '@/lib/marketing-plan/promo/gates'
import { hardNotGreen } from '@/lib/marketing-plan/approve-plan-gates'
import {
  archiveSameGoalApprovedPlans,
  reconcileSameGoalApprovedPlans,
  releaseSupersedeUnlessApproved,
  type ArchiveSameGoalResult,
} from '@/lib/marketing-plan/promo/supersede-prior-approved-write'
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
  /** Only with `requireAllGreen`: gates pass but some applicable check is not green. Nothing was written. */
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
    return {
      stop: {
        kind: 'needs_confirmation',
        planStart: plan.start_date ?? '见计划',
        planEnd: plan.end_date ?? '见计划',
        checks: notGreen,
      },
    }
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

  // Dispatch first, then archive older approved plans, then flip this one.
  // A failed archive is rolled back inside that call. A failed flip puts those
  // plans back to approved. After a successful flip, keep only the latest
  // approved plan for this goal. Plans with a promo structure do not dispatch legacy tasks.
  const dispatch: Dispatch = hasPromoField(plan.plan_data)
    ? { marketing_plan_id: plan.id, tasks_created: 0, tasks_skipped: 0, task_ids: [], packages_created: 0, package_ids: [] }
    : await dispatchPlanTasks(plan)

  return commitApproval({ plan, clientId: args.clientId, approvedBy: args.approvedBy, dispatch, gated: gates.gated })
}

async function commitApproval(args: {
  plan: MarketingPlan
  clientId: string
  approvedBy: string | null
  dispatch: Dispatch
  gated: Gated
}): Promise<ApprovePlanResult> {
  const approvedAt = new Date().toISOString()
  const held = await archiveSameGoalApprovedPlans({
    clientId: args.clientId,
    approving: args.plan,
    at: approvedAt,
  })
  if (!held.ok) {
    await revokePlanTasks(args.plan.id, args.clientId)
    return { kind: 'conflict', status: held.rolledBack ? 409 : 500, error: held.error }
  }
  const receipt = buildReceipt(args, approvedAt)
  const flipped = await flipToApproved(args.plan, args.clientId, approvedAt, receipt)
  if (!flipped.ok) return abandonFlip(args.plan, args.clientId, held, flipped)
  const lost = await lostToNewerPlan(args.clientId, args.plan)
  if (lost) return lost
  return { kind: 'approved', plan: flipped.plan, dispatch: args.dispatch, receipt }
}

const NEWER_WON = '同一目标已经有一份更新的已批准计划，这份已收起。请刷新后查看。'

async function lostToNewerPlan(clientId: string, approving: MarketingPlan): Promise<ApprovePlanResult | null> {
  const reconciled = await reconcileSameGoalApprovedPlans({ clientId, approving })
  if (!reconciled.ok) return { kind: 'conflict', status: 500, error: reconciled.error }
  if (reconciled.keptId !== null && reconciled.keptId !== approving.id) {
    return { kind: 'conflict', status: 409, error: NEWER_WON }
  }
  return null
}

function buildReceipt(
  args: { plan: MarketingPlan; approvedBy: string | null; dispatch: Dispatch; gated: Gated },
  approvedAt: string,
): ApprovalReceipt {
  return {
    request_id: randomUUID(),
    approved_by: args.approvedBy,
    approved_at: approvedAt,
    tasks_created: args.dispatch.tasks_created,
    tasks_skipped: args.dispatch.tasks_skipped ?? 0,
    packages_created: args.dispatch.packages_created,
    ...(args.gated.snapshot ? { gate_snapshot: args.gated.snapshot } : {}),
    ...(args.gated.hash ? { content_hash: args.gated.hash } : {}),
  }
}

async function flipToApproved(
  plan: MarketingPlan,
  clientId: string,
  approvedAt: string,
  receipt: ApprovalReceipt,
): Promise<{ ok: true; plan: MarketingPlan } | { ok: false; error: unknown; missed: boolean; duplicate: boolean }> {
  const { data: updated, error } = await supabaseAdmin
    .from('marketing_plans')
    .update({
      status: 'approved',
      approved_at: approvedAt,
      generation_meta: { ...(plan.generation_meta ?? {}), approval_receipt: receipt },
    })
    .eq('id', plan.id)
    .eq('client_id', clientId)
    .eq('status', 'draft')
    .eq('updated_at', plan.updated_at) // saved during checks/dispatch → do not approve
    .select('*')
    .maybeSingle()
  if (!error && updated) return { ok: true, plan: updated as MarketingPlan }
  return { ok: false, error, missed: !error && !updated, duplicate: isUniqueViolation(error) }
}

/** Postgres 23505: the one-approved-plan-per-goal index refused a second approved plan. */
function isUniqueViolation(error: unknown): boolean {
  return !!error && typeof error === 'object' && (error as { code?: unknown }).code === '23505'
}

const OTHER_APPROVED = '同一目标已经有另一份已批准的计划，这份没有批准。请刷新后查看。'

async function abandonFlip(
  plan: MarketingPlan,
  clientId: string,
  held: Extract<ArchiveSameGoalResult, { ok: true }>,
  flipped: { error: unknown; missed: boolean; duplicate: boolean },
): Promise<ApprovePlanResult> {
  const released = await releaseSupersedeUnlessApproved({
    clientId,
    planId: plan.id,
    approvingId: plan.id,
    approving: plan,
    archived: held.archived,
  })
  if (!released.ok) return { kind: 'conflict', status: 500, error: released.error }
  if (released.planNowApproved) {
    return { kind: 'conflict', status: 409, error: '这份计划刚刚已经被批准了，本次请求没有重复处理。' }
  }
  if (flipped.duplicate) {
    await revokePlanTasks(plan.id, clientId)
    return { kind: 'conflict', status: 409, error: OTHER_APPROVED }
  }
  if (flipped.missed) return loseRace(plan.id, clientId)
  console.error('[marketing-plan approve] status update failed, revoking dispatch:', flipped.error)
  await revokePlanTasks(plan.id, clientId)
  return { kind: 'conflict', status: 500, error: '批准没有保存成功，已撤销本次派发，请稍后重试。' }
}
