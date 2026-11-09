/**
 * Authenticated submission for one confirmed budget-step card.
 * The human identity is the session user. This file does not write a budget.
 */

import { requirePaidClientAccess } from '@/lib/auth/client-access'
import type { KernelDeps } from '@/lib/kernel/deps'
import { runAction, type ActionRunOutcome } from '@/lib/kernel/runner'
import { cardFields } from '@/lib/ads-budget-card/write-gate'
import type { BudgetExecuteCall } from '@/lib/ads-budget-card/path'

const SCALE_KEY = 'ads.scale_unit_budget'
const CUT_KEY = 'ads.cut_unit_budget'

export async function submitBudgetCardAction(
  deps: KernelDeps,
  call: BudgetExecuteCall,
): Promise<{ ok: true; outcome: ActionRunOutcome } | { ok: false; reason: string }> {
  const access = await requirePaidClientAccess(call.clientId)
  if (!access.ok || !access.user.id) {
    return { ok: false, reason: '登录状态对不上，没有改日预算。' }
  }
  const outcome = await runAction(deps, {
    clientId: call.clientId,
    actionKey: call.raising ? SCALE_KEY : CUT_KEY,
    purpose: 'growth',
    goalId: call.goalId,
    triggeredBy: 'human',
    triggeredByRef: access.user.id,
    rationale: '已批准的处方出了一张预算步骤卡，执行走已有的预算路径',
    idempotencyNonce: call.nonce,
    evidence: {
      source: 'budget_step_card',
      idempotency_key: call.idempotencyKey,
      before_cents: call.beforeCents,
      after_cents: call.afterCents,
    },
    input: {
      cycle_date: call.cycleDate,
      ad_account_id: call.adAccountId,
      adset_id: call.adsetId,
      before_cents: call.beforeCents,
      after_cents: call.afterCents,
      ...cardFields(call.lock),
    },
  }, call.raising ? { requireHumanApproval: true } : {})
  return { ok: true, outcome }
}
