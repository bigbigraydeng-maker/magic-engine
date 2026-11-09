/**
 * Hand one budget step to the kernel action that already writes it.
 * Raises wait for the existing PM approval. Cuts use the existing reduce path.
 * Read-back is the action's own readback step. This file never calls Meta.
 */

import type { KernelDeps } from '@/lib/kernel/deps'
import { listSteps } from '@/lib/kernel/store'
import type { ActionRunStep } from '@/lib/kernel/types'
import { submitBudgetCardAction } from '@/lib/action-submission/ads-budget-card'
import {
  interpretBudgetOutcome,
  readbackFromSteps,
  type BudgetExecuteCall,
  type BudgetExecuteResult,
  type BudgetOutcomeView,
  type BudgetPath,
} from './path'

export function kernelBudgetPath(kernel: KernelDeps): BudgetPath {
  return { execute: (call) => executeOnKernel(kernel, call) }
}

export async function executeOnKernel(kernel: KernelDeps, call: BudgetExecuteCall): Promise<BudgetExecuteResult> {
  const submitted = await submitBudgetCardAction(kernel, call)
  if (!submitted.ok) return refused(submitted.reason)
  const outcome = submitted.outcome
  const steps = await stepsOf(kernel, outcome.kind, outcome.run.id, outcome.execution?.steps ?? null)
  return interpretBudgetOutcome(viewFrom(outcome.kind, outcome.run.id, outcome.humanReason, steps), call.afterCents)
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

function refused(reason: string): BudgetExecuteResult {
  return { kind: 'refused', wrote: false, readbackCents: null, actionRunId: null, reason }
}
