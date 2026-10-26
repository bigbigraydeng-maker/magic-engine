/**
 * Save an unapproved marketing-plan draft for the ads agent.
 * Budget must stay within the recomputed plan seed and the account caps.
 * Status, approval, and cap tables are never written here.
 */

import type { AccountCapFacts } from '@/lib/marketing-plan/promo/budget-caps'
import { collectPhaseBudgetProblems } from '@/lib/marketing-plan/promo/budget-caps'
import { allAdsSteps, type PromoSpec } from '@/lib/marketing-plan/promo/spec'
import type { GoalFact } from '@/lib/marketing-plan/promo/reconcile'
import { seedBudgetProblems } from '@/lib/ads-strategy/plan-seed/budget-ceiling'
import type { PlanSeedRead } from '@/lib/ads-strategy/plan-seed/read-for-client'
import type { AgentDraftRequest } from '@/lib/marketing-plan/agent-draft-parse'

const USABLE_GOAL = new Set(['draft', 'active'])

export interface AgentPlanRow {
  id: string
  status: string
  updatedAt: string
  title: string
  startDate: string | null
  endDate: string | null
  planData: Record<string, unknown>
  generationMeta: Record<string, unknown> | null
}

export interface BudgetFacts {
  accounts: readonly AccountCapFacts[]
  clientCapCents: number | null
}

export interface AgentDraftDeps {
  now: () => Date
  readSeed: (clientId: string, prescriptionId: string) => Promise<PlanSeedRead>
  loadGoal: (clientId: string, goalId: string) => Promise<GoalFact | null>
  loadBudget: (clientId: string, spec: PromoSpec) => Promise<BudgetFacts | 'unreadable'>
  loadPlan: (clientId: string, planId: string) => Promise<AgentPlanRow | null | 'error'>
  insertPlan: (row: DraftInsert) => Promise<string | null>
  updatePlan: (planId: string, clientId: string, updatedAt: string, patch: DraftPatch) => Promise<boolean | null>
}

export interface DraftInsert {
  client_id: string
  campaign_id: null
  master_brief_id: null
  initiative_id: null
  title: string
  status: 'draft'
  start_date: string | null
  end_date: string | null
  plan_data: Record<string, unknown>
  generation_meta: Record<string, unknown>
  approved_at: null
}

export interface DraftPatch {
  plan_data: Record<string, unknown>
  generation_meta: Record<string, unknown>
  title?: string
  start_date?: string | null
  end_date?: string | null
}

export interface DraftSaveResult {
  status: number
  code: string
  error: string | null
  problems?: string[]
  planId?: string
}

export async function saveAgentDraft(input: {
  clientId: string
  keyId: string
  request: AgentDraftRequest
  deps: AgentDraftDeps
}): Promise<DraftSaveResult> {
  const ready = await prepareDraft(input)
  if (!ready.ok) return ready.result
  const stamp = agentStamp(input.keyId, input.request.prescriptionId, input.deps.now().toISOString())
  if (input.request.planId) return updateExisting(input, ready.spec, stamp)
  return createDraft(input, ready.spec, stamp)
}

async function prepareDraft(input: {
  clientId: string
  request: AgentDraftRequest
  deps: AgentDraftDeps
}): Promise<{ ok: true; spec: PromoSpec } | { ok: false; result: DraftSaveResult }> {
  const goal = await input.deps.loadGoal(input.clientId, input.request.spec.goal_id)
  if (!goal) return { ok: false, result: fail(400, 'goal_missing', '目标不存在或不属于这个客户') }
  if (!USABLE_GOAL.has(goal.status)) return { ok: false, result: fail(400, 'goal_unusable', '只能挂草稿或进行中的目标') }
  const budget = await assertBudget(input.clientId, input.request, input.deps)
  if (!budget.ok) return { ok: false, result: budget.result }
  return { ok: true, spec: input.request.spec }
}

async function assertBudget(
  clientId: string,
  request: AgentDraftRequest,
  deps: AgentDraftDeps,
): Promise<{ ok: true } | { ok: false; result: DraftSaveResult }> {
  const seed = await deps.readSeed(clientId, request.prescriptionId)
  if (seed.status === 404) return { ok: false, result: fail(404, 'prescription_missing', '处方不存在') }
  if (seed.status !== 200 || seed.body.success !== true) {
    return { ok: false, result: fail(503, 'seed_unavailable', '算不出计划草稿建议，这次没有保存') }
  }
  if (allAdsSteps(request.spec).length === 0) return { ok: true }
  const seedProblems = seedBudgetProblems(request.spec, seed.body.seed ?? null)
  if (seedProblems.length > 0) return { ok: false, result: fail(400, 'budget_over', '广告预算超过建议', seedProblems) }
  const caps = await deps.loadBudget(clientId, request.spec)
  if (caps === 'unreadable') return { ok: false, result: fail(503, 'cap_unreadable', '读不到预算上限，这次没有保存') }
  const capProblems = collectPhaseBudgetProblems(request.spec, caps.accounts, caps.clientCapCents)
  if (capProblems.length > 0) return { ok: false, result: fail(400, 'budget_over', '广告预算或账户不符合要求', capProblems) }
  return { ok: true }
}

async function createDraft(
  input: { clientId: string; request: AgentDraftRequest; deps: AgentDraftDeps },
  spec: PromoSpec,
  stamp: Record<string, unknown>,
): Promise<DraftSaveResult> {
  if (!input.request.title) return fail(400, 'invalid_title', '新建草稿要填写标题')
  const id = await input.deps.insertPlan(insertRow(input.clientId, input.request, spec, stamp))
  if (!id) return fail(500, 'write_failed', '草稿没有保存')
  return { status: 200, code: 'saved', error: null, planId: id }
}

async function updateExisting(
  input: { clientId: string; request: AgentDraftRequest; deps: AgentDraftDeps },
  spec: PromoSpec,
  stamp: Record<string, unknown>,
): Promise<DraftSaveResult> {
  const planId = input.request.planId
  if (!planId) return fail(400, 'invalid_plan', '计划编号不正确')
  const plan = await input.deps.loadPlan(input.clientId, planId)
  if (plan === 'error') return fail(503, 'plan_unreadable', '计划没有读到，这次没有保存')
  if (!plan) return fail(404, 'plan_missing', '计划不存在')
  if (plan.status !== 'draft') return fail(409, 'not_draft', '只有未批准的草稿可以保存')
  if (input.request.expectedUpdatedAt !== plan.updatedAt) {
    return fail(409, 'conflict', '这份计划刚刚在别处被改过，这次保存没有生效。请刷新后再试。')
  }
  const dates = mergedDates(input.request, plan)
  if (dates === 'bad') return fail(400, 'invalid_dates', '结束日早于开始日')
  const wrote = await input.deps.updatePlan(planId, input.clientId, plan.updatedAt, patchOf(plan, input.request, spec, stamp))
  if (wrote === null) return fail(500, 'write_failed', '草稿没有保存')
  if (!wrote) return fail(409, 'conflict', '这份计划刚刚在别处被改过，这次保存没有生效。请刷新后再试。')
  return { status: 200, code: 'saved', error: null, planId }
}

function insertRow(clientId: string, request: AgentDraftRequest, spec: PromoSpec, stamp: Record<string, unknown>): DraftInsert {
  return {
    client_id: clientId,
    campaign_id: null,
    master_brief_id: null,
    initiative_id: null,
    title: request.title ?? '',
    status: 'draft',
    start_date: request.startDate ?? null,
    end_date: request.endDate ?? null,
    plan_data: { social: {}, blog: { monthly_count: 0, topics: [] }, kpis: {}, tasks: [], promo: spec },
    generation_meta: { ...stamp, blank_draft: { goal_id: spec.goal_id } },
    approved_at: null,
  }
}

function patchOf(plan: AgentPlanRow, request: AgentDraftRequest, spec: PromoSpec, stamp: Record<string, unknown>): DraftPatch {
  const patch: DraftPatch = {
    plan_data: { ...plan.planData, promo: spec },
    generation_meta: { ...(plan.generationMeta ?? {}), ...stamp, blank_draft: { goal_id: spec.goal_id } },
  }
  if (request.title !== undefined) patch.title = request.title
  if (request.startDate !== undefined) patch.start_date = request.startDate
  if (request.endDate !== undefined) patch.end_date = request.endDate
  return patch
}

function mergedDates(request: AgentDraftRequest, plan: AgentPlanRow): true | 'bad' {
  const start = request.startDate !== undefined ? request.startDate : plan.startDate
  const end = request.endDate !== undefined ? request.endDate : plan.endDate
  if (start && end && end < start) return 'bad'
  return true
}

function agentStamp(keyId: string, prescriptionId: string, savedAt: string): Record<string, unknown> {
  return { agent_draft: { key_id: keyId, prescription_id: prescriptionId, saved_at: savedAt } }
}

function fail(status: number, code: string, error: string, problems?: string[]): DraftSaveResult {
  return { status, code, error, ...(problems ? { problems } : {}) }
}
