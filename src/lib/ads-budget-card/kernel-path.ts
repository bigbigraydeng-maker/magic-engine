/**
 * Hand one budget step to the kernel action that already writes it.
 * Raises wait for the existing PM approval. Cuts use the existing reduce path.
 * Read-back is the action's own readback step. This file never calls Meta.
 */

import type { KernelDeps } from '@/lib/kernel/deps'
import { runAction } from '@/lib/kernel/runner'
import { listSteps } from '@/lib/kernel/store'
import type { ActionRunStep } from '@/lib/kernel/types'
import {
  interpretBudgetOutcome,
  kernelInput,
  readbackFromSteps,
  type BudgetExecuteCall,
  type BudgetExecuteResult,
  type BudgetOutcomeView,
  type BudgetPath,
} from './path'

const SCALE_KEY = 'ads.scale_unit_budget'
const CUT_KEY = 'ads.cut_unit_budget'

export function kernelBudgetPath(kernel: KernelDeps): BudgetPath {
  return { execute: (call) => executeOnKernel(kernel, call) }
}

export async function executeOnKernel(kernel: KernelDeps, call: BudgetExecuteCall): Promise<BudgetExecuteResult> {
  const outcome = await runAction(kernel, submitFrom(call), call.raising ? { requireHumanApproval: true } : {})
  const steps = await stepsOf(kernel, outcome.kind, outcome.run.id, outcome.execution?.steps ?? null)
  return interpretBudgetOutcome(viewFrom(outcome.kind, outcome.run.id, outcome.humanReason, steps), call.afterCents)
}

function submitFrom(call: BudgetExecuteCall) {
  return {
    clientId: call.clientId,
    actionKey: call.raising ? SCALE_KEY : CUT_KEY,
    purpose: 'growth' as const,
    goalId: call.goalId,
    triggeredBy: 'human' as const,
    triggeredByRef: null,
    rationale: '已批准的处方出了一张预算步骤卡，执行走已有的预算路径',
    idempotencyNonce: call.nonce,
    evidence: {
      source: 'budget_step_card',
      idempotency_key: call.idempotencyKey,
      before_cents: call.beforeCents,
      after_cents: call.afterCents,
    },
    input: kernelInput(call),
  }
}

async function stepsOf(
  kernel: KernelDeps,
  kind: string,
  runId: string,
  carried: ActionRunStep[] | null,
): Promise<ActionRunStep[]> {
  if (carried && carried.length > 0) return carried
  if (kind !== 'succeeded' && kind !== 'idempotent_hit' && kind !== 'dead_letter') return []
  return listSteps(kernel.supabase, runId)
}

function viewFrom(
  kind: string,
  runId: string,
  humanReason: string | null,
  steps: readonly ActionRunStep[],
): BudgetOutcomeView {
  const readback = readbackFromSteps(steps)
  return { kind, runId, humanReason, readbackCents: readback.cents, verificationPassed: readback.passed }
}
