/** Authenticated manual stop-loss submission. Provider writes stay inside Kernel capabilities. */
import { requirePlanApproverAccess, type ClientAccessResult } from '@/lib/auth/client-access'
import { runAction, type ActionRunOutcome, type SubmitActionInput } from '@/lib/kernel/runner'
import type { KernelDeps } from '@/lib/kernel/deps'

export type StopLossAccess = Extract<ClientAccessResult, { ok: true }>
export function requireStopLossAccess(clientId: string): Promise<ClientAccessResult> {
  // Money-changing action: internal accounts only (paid clients include the client's own staff).
  return requirePlanApproverAccess(clientId)
}

export type StopLossKernelAction = 'pause_campaign' | 'cut_campaign' | 'cut_unit'
export interface StopLossKernelTarget { id: string; name: string; currentCents: number; afterCents?: number }
export interface StopLossSubmitInput {
  clientId: string; access: StopLossAccess; goalId?: string; campaignId: string; adAccountId: string
  cycleDate: string; requestId: string; action: StopLossKernelAction; targets: readonly StopLossKernelTarget[]
}
export interface StopLossSubmitResult { action: StopLossKernelAction; runs: Array<{ entityId: string; name: string; runId: string; kind: ActionRunOutcome['kind']; humanReason: string | null; warnings: string[] }> }

/** Sequential by design: same-account envelope facts must see prior submissions. */
export async function submitStopLossThroughKernel(deps: KernelDeps, input: StopLossSubmitInput): Promise<StopLossSubmitResult> {
  const runs: StopLossSubmitResult['runs'] = []
  for (const target of input.targets) {
    let actionKey: SubmitActionInput['actionKey']
    let actionInput: Record<string, unknown>
    let envelopeRequest: 'pause' | 'budget_change'
    if (input.action === 'pause_campaign') {
      actionKey = 'ads.pause_campaign'; envelopeRequest = 'pause'
      actionInput = { cycle_date: input.cycleDate, ad_account_id: input.adAccountId, campaign_id: input.campaignId }
    } else if (input.action === 'cut_campaign') {
      actionKey = 'ads.cut_campaign_budget'; envelopeRequest = 'budget_change'
      actionInput = { cycle_date: input.cycleDate, ad_account_id: input.adAccountId, campaign_id: input.campaignId, after_cents: target.afterCents }
    } else {
      actionKey = 'ads.cut_unit_budget'; envelopeRequest = 'budget_change'
      actionInput = { cycle_date: input.cycleDate, ad_account_id: input.adAccountId, adset_id: target.id, after_cents: target.afterCents }
    }
    const submit: SubmitActionInput = {
      clientId: input.clientId, actionKey,
      purpose: input.action === 'cut_campaign' ? 'maintenance' : 'growth',
      goalId: input.action === 'cut_campaign' ? null : input.goalId,
      triggeredBy: 'human',
      triggeredByRef: input.access.user.id, rationale: `广告健康看板人工止损：${input.action}`,
      idempotencyNonce: input.requestId,
      evidence: { source: 'ads_health_stop_loss', campaign_id: input.campaignId, entity_name: target.name,
        current_daily_budget_cents: target.currentCents, requested_change: envelopeRequest },
      input: actionInput,
    }
    const outcome = await runAction(deps, submit)
    const warnings = outcome.execution?.steps.flatMap(step => {
      const warning = step.step_key === 'apply' ? step.output.status_warning : undefined
      return typeof warning === 'string' && warning.trim() ? [warning] : []
    }) ?? []
    runs.push({ entityId: target.id, name: target.name, runId: outcome.run.id, kind: outcome.kind, humanReason: outcome.humanReason, warnings })
  }
  return { action: input.action, runs }
}
