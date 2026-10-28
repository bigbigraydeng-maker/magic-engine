/**
 * Confirming the plan card approves that plan. Decline does not.
 * Every other confirmation card still only records the click.
 */

import type { KernelDeps } from '@/lib/kernel/deps'
import type { ActionRun } from '@/lib/kernel/types'
import { CONFIRMATION_ACTION_KEY } from '@/lib/kernel/registry-confirmation'
import {
  decideConfirmationCard,
  type CardClicker,
  type CardResolution,
  type ConfirmationCardView,
} from '@/lib/confirmation-card'
import { confirmBlockReason } from '@/lib/confirmation-card/facts'
import { ConfirmationCardError } from '@/lib/confirmation-card/errors'
import { notesFor } from '@/lib/confirmation-card/records'
import { isExpired, presentCard, readStoredCard, type StoredCard } from '@/lib/confirmation-card/view'
import { approvePlan, type ApprovePlanResult } from '@/lib/marketing-plan/approve-plan'
import {
  PLAN_CARD_OPC_ONLY,
  planCardMayConfirmDespiteChecks,
  trustedPlanCard,
} from '@/lib/marketing-plan/plan-card-subject'

export interface CardDecisionArgs {
  readonly clientId: string
  readonly runId: string
  readonly clicker: CardClicker
  readonly resolution: CardResolution
  readonly expectedDecisionId: string
  readonly fingerprint: string
  readonly approvedBy: string | null
  readonly now?: Date
}

function decisionArgs(args: CardDecisionArgs, now: Date) {
  return {
    clientId: args.clientId,
    runId: args.runId,
    clicker: args.clicker,
    resolution: args.resolution,
    expectedDecisionId: args.expectedDecisionId,
    fingerprint: args.fingerprint,
    now,
  }
}

function isThisPlanCard(run: ActionRun, clientId: string, stored: StoredCard | null): stored is StoredCard {
  if (!stored || run.client_id !== clientId || run.action_key !== CONFIRMATION_ACTION_KEY) return false
  return trustedPlanCard(stored) !== null
}

function refusal(result: ApprovePlanResult): ConfirmationCardError {
  if (result.kind === 'approved' || result.kind === 'already_approved' || result.kind === 'ready') {
    return new ConfirmationCardError('invalid', '这张卡没有批准计划。')
  }
  switch (result.kind) {
    case 'stale':
      return new ConfirmationCardError('stale', '这份计划已经改过了，这张卡不能再用来批准。请到推广计划页看现在这一版。')
    case 'blocked':
      return new ConfirmationCardError('hard_check', '检查清单有没过的硬门，这张卡没有批准计划。')
    case 'not_draft':
      return new ConfirmationCardError('stale', '它已经不是草稿，这张卡没有再改计划。')
    case 'not_found':
      return new ConfirmationCardError('not_found', '找不到这张卡上的计划，没有批准。')
    case 'invalid_spec':
      return new ConfirmationCardError('invalid', '计划内容格式不合法，没有批准。')
    case 'conflict':
      return new ConfirmationCardError('stale', result.error)
    default:
      return new ConfirmationCardError('invalid', '这张卡没有批准计划。')
  }
}

async function showCard(deps: KernelDeps, run: ActionRun, clicker: CardClicker, now: Date): Promise<ConfirmationCardView> {
  const decisionId = run.authorization_decision_id
  if (!decisionId) throw new ConfirmationCardError('invalid', '这张卡没有审批编号。')
  const notes = await notesFor(deps.supabase, [decisionId])
  const note = notes.get(decisionId)
  return presentCard({
    run,
    decisionId,
    decisionReason: note?.reason ?? '',
    decidedBy: note?.decidedBy ?? null,
    clicker,
    now,
  })
}

function approvedView(card: ConfirmationCardView): ConfirmationCardView {
  const who = card.statusLine.split(' 点了')[0] || '有人'
  return { ...card, statusLine: `${who} 点了确认。这份计划已批准。还没开投，不会花钱。` }
}

function planArgs(args: CardDecisionArgs, planId: string, contentHash: string, commit: boolean) {
  return {
    clientId: args.clientId,
    planId,
    approvedBy: args.approvedBy,
    requireAllGreen: false,
    expectedContentHash: contentHash,
    commit,
  }
}

async function guardClick(
  deps: KernelDeps,
  args: CardDecisionArgs,
  run: ActionRun,
  stored: StoredCard,
  now: Date,
): Promise<ConfirmationCardView | null> {
  if (args.clicker.kind !== 'opc') throw new ConfirmationCardError('forbidden', PLAN_CARD_OPC_ONLY)
  if (args.fingerprint !== stored.fingerprint) {
    throw new ConfirmationCardError('stale', '你看到的内容已经不是这一张卡了。请刷新后再点。')
  }
  if (run.status === 'pending_approval' && isExpired(stored.issuedAt, now)) {
    return decideConfirmationCard(deps, decisionArgs(args, now))
  }
  if (run.status !== 'pending_approval' && run.status !== 'authorized') {
    throw new ConfirmationCardError('not_waiting', '这张卡已经有结果了，不能再点。')
  }
  if (run.status === 'pending_approval' && run.authorization_decision_id !== args.expectedDecisionId) {
    throw new ConfirmationCardError('stale', '这张卡的编号对不上，请刷新后再点。')
  }
  if (!planCardMayConfirmDespiteChecks(stored)) {
    const block = confirmBlockReason(stored.hardChecks)
    if (block) throw new ConfirmationCardError('hard_check', block)
  }
  return null
}

async function confirmPlan(
  deps: KernelDeps,
  args: CardDecisionArgs,
  run: ActionRun,
  stored: StoredCard,
  now: Date,
): Promise<ConfirmationCardView> {
  const early = await guardClick(deps, args, run, stored, now)
  if (early) return early
  const parsed = trustedPlanCard(stored)
  if (!parsed) throw new ConfirmationCardError('invalid', '这张卡认不出是哪一份计划，没有批准。')
  // Read first. The click is recorded only when this would approve. The write comes after.
  const preview = await approvePlan(planArgs(args, parsed.planId, parsed.contentHash, false))
  if (preview.kind !== 'ready' && preview.kind !== 'already_approved') throw refusal(preview)
  const card = run.status === 'authorized'
    ? await showCard(deps, run, args.clicker, now)
    : await decideConfirmationCard(deps, decisionArgs(args, now))
  if (card.status !== 'confirmed') return card
  const result = await approvePlan(planArgs(args, parsed.planId, parsed.contentHash, true))
  if (result.kind !== 'approved' && result.kind !== 'already_approved') throw refusal(result)
  return approvedView(card)
}

export async function applyConfirmationDecision(
  deps: KernelDeps,
  args: CardDecisionArgs,
): Promise<ConfirmationCardView> {
  const now = args.now ?? deps.now()
  const run = await deps.requireRun(args.runId)
  const stored = readStoredCard(run.input)
  if (!isThisPlanCard(run, args.clientId, stored)) {
    return decideConfirmationCard(deps, decisionArgs(args, now))
  }
  if (args.resolution === 'decline') return decideConfirmationCard(deps, decisionArgs(args, now))
  return confirmPlan(deps, args, run, stored, now)
}
