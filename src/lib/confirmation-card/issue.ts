import { randomUUID } from 'crypto'
import type { KernelDeps } from '@/lib/kernel/deps'
import type { ActionRun } from '@/lib/kernel/types'
import { runAction, submitActionRun } from '@/lib/kernel/runner'
import { CONFIRMATION_ACTION_KEY } from '@/lib/kernel/registry-confirmation'
import type { CardClicker } from './actor'
import { assertMayIssue } from './actor'
import { contentFingerprint, normalizeFacts, type CardFacts } from './facts'
import { isPlanApprovalCard } from '@/lib/marketing-plan/plan-card-subject'
import { ensureConfirmationPolicy } from './policy'
import { listPendingCards } from './records'
import { ConfirmationCardError } from './errors'
import { settleExpired, voidStaleCard } from './settle'
import { isExpired, presentCard, readStoredCard, type ConfirmationCardView } from './view'

function issuerName(clicker: CardClicker): string {
  if (clicker.kind === 'opc' || clicker.kind === 'fde') return clicker.email
  if (clicker.kind === 'agent') return clicker.email ?? 'agent'
  return 'unknown'
}

function cardInput(facts: CardFacts, fingerprint: string, issuedAt: string): Record<string, unknown> {
  return {
    subject_key: facts.subjectKey,
    content_fingerprint: fingerprint,
    what: facts.what,
    account_label: facts.account,
    amount_label: facts.amount,
    date_label: facts.date,
    scope_label: facts.scope,
    issued_at: issuedAt,
    hard_checks: JSON.stringify(facts.hardChecks),
  }
}

async function retireOld(
  deps: KernelDeps,
  clientId: string,
  subjectKey: string,
  fingerprint: string,
  now: Date,
): Promise<ActionRun | null> {
  const pending = await listPendingCards(deps.supabase, clientId)
  let fresh: ActionRun | null = null
  for (const run of pending) {
    const stored = readStoredCard(run.input)
    if (!stored || stored.subjectKey !== subjectKey) continue
    if (stored.fingerprint !== fingerprint) {
      await voidStaleCard(deps, run)
      continue
    }
    if (isExpired(stored.issuedAt, now)) {
      await settleExpired(deps, run)
      continue
    }
    fresh = run
  }
  return fresh
}

async function openRun(
  deps: KernelDeps,
  clientId: string,
  clicker: CardClicker,
  facts: CardFacts,
  fingerprint: string,
  now: Date,
): Promise<ActionRun> {
  const issuedAt = now.toISOString()
  const input = cardInput(facts, fingerprint, issuedAt)
  const base = {
    clientId,
    actionKey: CONFIRMATION_ACTION_KEY,
    purpose: 'housekeeping' as const,
    triggeredBy: clicker.kind === 'agent' ? 'agent' as const : 'human' as const,
    triggeredByRef: issuerName(clicker),
    input,
    rationale: facts.what,
  }
  const probe = await submitActionRun(deps, base)
  const reusable = !probe.existing || probe.run.status === 'queued' || probe.run.status === 'authorizing'
  const outcome = await runAction(
    deps,
    reusable ? base : { ...base, idempotencyNonce: randomUUID() },
    { requireHumanApproval: true },
  )
  if (outcome.kind !== 'pending_approval') {
    throw new ConfirmationCardError('rule_blocked', outcome.humanReason ?? '没有生成确认卡。')
  }
  return outcome.run
}

export async function issueConfirmationCard(
  deps: KernelDeps,
  args: { clientId: string; clicker: CardClicker; facts: CardFacts; now?: Date; allowPlanApproval?: boolean },
): Promise<ConfirmationCardView> {
  assertMayIssue(args.clicker, args.clientId)
  const now = args.now ?? deps.now()
  const facts = normalizeFacts(args.facts)
  if (isPlanApprovalCard(facts.subjectKey) && args.allowPlanApproval !== true) {
    throw new ConfirmationCardError('invalid', '计划批准卡不能从这里开。请从处方的同意里出。')
  }
  const fingerprint = contentFingerprint(facts)
  await ensureConfirmationPolicy(deps.supabase, args.clientId, issuerName(args.clicker), now)
  const fresh = await retireOld(deps, args.clientId, facts.subjectKey, fingerprint, now)
  const run = fresh ?? await openRun(deps, args.clientId, args.clicker, facts, fingerprint, now)
  const decisionId = run.authorization_decision_id
  if (!decisionId) throw new ConfirmationCardError('invalid', '确认卡没有挂上审批编号，没有当成已确认。')
  return presentCard({
    run,
    decisionId,
    decisionReason: '',
    decidedBy: null,
    clicker: args.clicker,
    now,
  })
}
