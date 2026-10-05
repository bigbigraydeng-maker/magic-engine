/** Authenticated submission path for a human-requested campaign budget decrease. */

import { requirePaidClientAccess, type ClientAccessResult } from '@/lib/auth/client-access'
import type { KernelDeps } from '@/lib/kernel/deps'
import { getRun } from '@/lib/kernel/store'
import { runAction, submitActionRun, type ActionRunOutcome, type SubmitActionInput } from '@/lib/kernel/runner'

export type AdsCampaignBudgetAccess = Extract<ClientAccessResult, { ok: true }>

/** Keep the authenticated actor source next to the only human-triggered submission. */
export function requireAdsCampaignBudgetAccess(clientId: string): Promise<ClientAccessResult> {
  return requirePaidClientAccess(clientId)
}

export interface SubmitAdsCampaignBudgetDecreaseInput {
  readonly clientId: string
  readonly access: AdsCampaignBudgetAccess
  readonly cycleDate: string
  readonly adAccountId: string
  readonly campaignId: string
  readonly afterCents: number
  readonly executionItemId?: string | null
}

function buildAdsCampaignBudgetDecreaseInput(
  input: SubmitAdsCampaignBudgetDecreaseInput,
): SubmitActionInput {
  return {
    clientId: input.clientId,
    actionKey: 'ads.cut_campaign_budget',
    purpose: 'maintenance',
    executionItemId: input.executionItemId ?? null,
    triggeredBy: 'human',
    triggeredByRef: input.access.user.id,
    rationale: '从广告执行看板提交广告系列日预算下调',
    evidence: { source: 'meta-ads/execute' },
    input: {
      cycle_date: input.cycleDate,
      ad_account_id: input.adAccountId,
      campaign_id: input.campaignId,
      after_cents: input.afterCents,
    },
  }
}

/** Persist the Kernel receipt before dispatching the durable Inngest job. */
export async function queueAdsCampaignBudgetDecrease(
  deps: KernelDeps,
  input: SubmitAdsCampaignBudgetDecreaseInput,
) {
  return submitActionRun(deps, buildAdsCampaignBudgetDecreaseInput(input))
}

/** Inngest resumes only the authenticated, already-persisted budget action. */
export async function runQueuedAdsCampaignBudgetDecrease(
  deps: KernelDeps,
  clientId: string,
  runId: string,
): Promise<ActionRunOutcome> {
  const run = await getRun(deps.supabase, runId)
  if (!run || run.client_id !== clientId || run.action_key !== 'ads.cut_campaign_budget' || run.triggered_by !== 'human') {
    throw new Error('Budget action run is missing or does not match the requested client and action.')
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
