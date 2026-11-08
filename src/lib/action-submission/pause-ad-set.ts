/**
 * Submit one confirmed ad-set pause through the existing kernel pause path.
 * The kernel human label is attached only after the confirming session has an email.
 * This file does not write a resume, and it does not call the pause a second time.
 */

import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { approveAndRun, runAction, type ActionRunOutcome } from '@/lib/kernel/runner'
import type { KernelDeps } from '@/lib/kernel/deps'
import type { TriggeredBy } from '@/lib/kernel/types'

const SESSION_HUMAN: TriggeredBy = 'human'

export interface PauseExecuteArgs {
  readonly clientId: string
  readonly goalId: string
  readonly adAccountId: string
  readonly adsetId: string
  readonly cycleDate: string
  readonly nonce: string
  readonly basis: string
}

export interface PauseExecuteResult {
  readonly kind: 'paused' | 'mismatch' | 'refused' | 'in_progress'
  readonly before: string | null
  readonly after: string | null
  readonly runId: string | null
  readonly reason: string
}

export function triggerFromSessionUser(user: { email?: string | null }): { triggeredBy: TriggeredBy; triggeredByRef: string } | null {
  const email = user.email?.trim().toLowerCase()
  if (!email || !email.includes('@')) return null
  return { triggeredBy: SESSION_HUMAN, triggeredByRef: email }
}

export function pauseUnitInput(args: Pick<PauseExecuteArgs, 'cycleDate' | 'adAccountId' | 'adsetId'>): Record<string, string> {
  return { cycle_date: args.cycleDate, ad_account_id: args.adAccountId, adset_id: args.adsetId }
}

export async function executeConfirmedPause(deps: KernelDeps, args: PauseExecuteArgs): Promise<PauseExecuteResult> {
  const access = await requirePaidClientAccess(args.clientId)
  if (!access.ok) return refused('登录已失效，没有去暂停。')
  const session = triggerFromSessionUser(access.user)
  if (!session) return refused('确认人没有登录邮箱，没有去暂停。')
  try {
    const first = await runAction(deps, submitInput(args, session))
    const outcome = first.kind === 'pending_approval' ? await approveOnce(deps, first, session.triggeredByRef) : first
    return mapOutcome(outcome)
  } catch {
    return refused('暂停没有做成，没有再写一次。')
  }
}

function submitInput(args: PauseExecuteArgs, session: { triggeredBy: TriggeredBy; triggeredByRef: string }) {
  return {
    clientId: args.clientId,
    actionKey: 'ads.pause_unit' as const,
    purpose: 'growth' as const,
    goalId: args.goalId,
    triggeredBy: session.triggeredBy,
    triggeredByRef: session.triggeredByRef,
    rationale: args.basis.slice(0, 180),
    idempotencyNonce: args.nonce,
    input: pauseUnitInput(args),
  }
}

async function approveOnce(
  deps: KernelDeps,
  pending: ActionRunOutcome,
  email: string,
): Promise<ActionRunOutcome> {
  const decisionId = pending.run.authorization_decision_id
  if (!decisionId) return pending
  return approveAndRun(deps, pending.run.id, email, { expectedDecisionId: decisionId })
}

function mapOutcome(outcome: ActionRunOutcome): PauseExecuteResult {
  const before = field(outcome, 'apply', 'prior_effective_status')
  const after = field(outcome, 'readback', 'status_now')
  if (outcome.kind === 'succeeded' && after === 'PAUSED') {
    return { kind: 'paused', before, after, runId: outcome.run.id, reason: '已暂停，回读是暂停。' }
  }
  if (outcome.kind === 'in_progress' || outcome.kind === 'idempotent_hit') {
    return { kind: 'in_progress', before, after, runId: outcome.run.id, reason: '已有一条同样的暂停记录，没有再写一次。' }
  }
  if (outcome.kind === 'dead_letter') {
    return { kind: 'mismatch', before, after, runId: outcome.run.id, reason: '回读和暂停不一致，已标失败，没有再写，也没有改回去。' }
  }
  return { kind: 'refused', before, after, runId: outcome.run.id, reason: outcome.humanReason ?? '没有暂停。' }
}

function field(outcome: ActionRunOutcome, stepKey: string, key: string): string | null {
  const step = outcome.execution?.steps.find((item) => item.step_key === stepKey)
  const value = step?.output?.[key]
  return typeof value === 'string' ? value : null
}

function refused(reason: string): PauseExecuteResult {
  return { kind: 'refused', before: null, after: null, runId: null, reason }
}
