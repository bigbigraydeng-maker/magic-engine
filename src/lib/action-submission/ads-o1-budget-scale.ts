/** Kernel submission/resume helpers for the single O1 budget-increase action. */
import { getDecision, getRun } from '@/lib/kernel/store'
import { runAction, type ActionRunOutcome } from '@/lib/kernel/runner'
import type { KernelDeps } from '@/lib/kernel/deps'
import { requirePaidClientAccess, type ClientAccessResult } from '@/lib/auth/client-access'

export const ADS_O1_BUDGET_SCALE_ACTION_KEY = 'ads.scale_unit_budget'
export type AdsO1BudgetScaleAccess = Extract<ClientAccessResult, { ok: true }>

export function requireAdsO1BudgetScaleAccess(clientId: string): Promise<ClientAccessResult> {
  return requirePaidClientAccess(clientId)
}

export interface SubmitAdsO1BudgetScaleInput {
  readonly clientId: string
  readonly access: AdsO1BudgetScaleAccess
  readonly goalId: string
  readonly cycleDate: string
  readonly adAccountId: string
  readonly adsetId: string
  readonly campaignId?: string
  readonly beforeCents: number
  readonly afterCents: number
  readonly evidence: Record<string, unknown>
}

export function submitAdsO1BudgetScale(deps: KernelDeps, input: SubmitAdsO1BudgetScaleInput): Promise<ActionRunOutcome> {
  return runAction(deps, {
    clientId: input.clientId,
    actionKey: ADS_O1_BUDGET_SCALE_ACTION_KEY,
    purpose: 'growth',
    goalId: input.goalId,
    triggeredBy: 'human',
    triggeredByRef: input.access.user.id,
    rationale: 'O1 连续三天出现积极信号；先由负责人核对预算调整，再决定是否执行',
    evidence: {
      source: 'ads_health_o1',
      current_daily_budget_cents: input.beforeCents,
      proposed_daily_budget_cents: input.afterCents,
      ...input.evidence,
    },
    input: {
      cycle_date: input.cycleDate,
      ad_account_id: input.adAccountId,
      adset_id: input.adsetId,
      ...(input.campaignId ? { campaign_id: input.campaignId } : {}),
      before_cents: input.beforeCents,
      after_cents: input.afterCents,
    },
  }, { requireHumanApproval: true })
}

/** Inngest may resume only the exact run that has a current human allow decision. */
export async function runApprovedAdsO1BudgetScale(deps: KernelDeps, clientId: string, runId: string): Promise<ActionRunOutcome> {
  const run = await getRun(deps.supabase, runId)
  if (!run || run.client_id !== clientId || run.action_key !== ADS_O1_BUDGET_SCALE_ACTION_KEY || run.status !== 'authorized') {
    throw new Error('O1 budget-scale run is missing, unauthorized, or does not match this client.')
  }
  if (!run.authorization_decision_id) throw new Error('O1 budget-scale run has no authorization decision.')
  const decision = await getDecision(deps.supabase, run.authorization_decision_id)
  if (!decision || decision.action_run_id !== run.id || decision.client_id !== clientId || decision.verdict !== 'allow' || decision.decided_by !== 'human') {
    throw new Error('O1 budget-scale run has no matching human approval.')
  }
  return runAction(deps, {
    clientId: run.client_id,
    actionKey: run.action_key,
    purpose: run.purpose,
    goalId: run.goal_id,
    executionItemId: run.execution_item_id,
    triggeredBy: run.triggered_by,
    triggeredByRef: run.triggered_by_ref,
    input: run.input,
    rationale: run.rationale,
    evidence: run.evidence,
    correlationId: run.correlation_id,
  })
}
