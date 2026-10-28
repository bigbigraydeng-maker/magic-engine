/**
 * What a person sees on the card. No raw payload, no hash on screen.
 */

import type { ActionRun } from '@/lib/kernel/types'
import type { CardClicker } from './actor'
import { buttonsFor } from './actor'
import { confirmBlockReason, type HardCheck } from './facts'
import { ConfirmationCardError } from './errors'
import { PLAN_CARD_OPC_ONLY, isPlanApprovalCard, planCardMayConfirmDespiteChecks } from '@/lib/marketing-plan/plan-card-subject'

export const CONFIRMATION_TTL_MS = 30 * 60 * 1000

export type CardStatus = 'waiting' | 'confirmed' | 'declined' | 'expired' | 'voided'

export interface StoredCard {
  readonly subjectKey: string
  readonly fingerprint: string
  readonly what: string
  readonly account: string
  readonly amount: string
  readonly date: string
  readonly scope: string
  readonly issuedAt: string
  readonly hardChecks: readonly HardCheck[]
}

export interface ConfirmationCardView {
  readonly runId: string
  readonly expectedDecisionId: string
  readonly fingerprint: string
  readonly what: string
  readonly account: string
  readonly amount: string
  readonly date: string
  readonly scope: string
  readonly expiresLabel: string
  readonly status: CardStatus
  readonly statusLine: string
  readonly confirmEnabled: boolean
  readonly declineEnabled: boolean
  readonly blockedReason: string | null
}

export function isExpired(issuedAt: string, now: Date): boolean {
  const issued = Date.parse(issuedAt)
  if (!Number.isFinite(issued)) return true
  return now.getTime() - issued >= CONFIRMATION_TTL_MS
}

export function expiryLabel(issuedAt: string): string {
  const at = new Date(Date.parse(issuedAt) + CONFIRMATION_TTL_MS)
  const text = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Pacific/Auckland',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(at)
  return `请在 ${text}（新西兰时间）前点。过了要重新出一张。`
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

export function readStoredCard(input: Record<string, unknown>): StoredCard | null {
  const subjectKey = asString(input.subject_key)
  const fingerprint = asString(input.content_fingerprint)
  const what = asString(input.what)
  const account = asString(input.account_label)
  const amount = asString(input.amount_label)
  const date = asString(input.date_label)
  const scope = asString(input.scope_label)
  const issuedAt = asString(input.issued_at)
  const rawChecks = asString(input.hard_checks)
  if (!subjectKey || !fingerprint || !what || !account || !amount || !date || !scope || !issuedAt || !rawChecks) {
    return null
  }
  let hardChecks: HardCheck[]
  try {
    const parsed = JSON.parse(rawChecks) as unknown
    if (!Array.isArray(parsed)) return null
    hardChecks = parsed as HardCheck[]
  } catch {
    return null
  }
  return { subjectKey, fingerprint, what, account, amount, date, scope, issuedAt, hardChecks }
}

export function classifyStatus(runStatus: string, reason: string, issuedAt: string, now: Date): CardStatus {
  if (runStatus === 'authorized') return 'confirmed'
  if (runStatus === 'pending_approval') return isExpired(issuedAt, now) ? 'expired' : 'waiting'
  if (reason.includes('过了 30 分钟')) return 'expired'
  if (reason.includes('内容变了')) return 'voided'
  return 'declined'
}

function statusLine(status: CardStatus, decidedBy: string | null, subjectKey: string): string {
  if (status === 'waiting') return '还没人点。'
  if (status === 'confirmed' && isPlanApprovalCard(subjectKey)) {
    return `${decidedBy ?? '有人'} 点了确认。还没开投，不会花钱。`
  }
  if (status === 'confirmed') return `${decidedBy ?? '有人'} 点了确认。这件事还没有开始做。`
  if (status === 'declined') return `${decidedBy ?? '有人'} 点了不做。`
  if (status === 'expired') return '过了 30 分钟没人点，这张卡作废了。'
  return '要做的事变了，这张旧卡作废了。'
}

function shownButtons(
  waiveChecks: boolean,
  clicker: CardClicker,
  hardBlock: string | null,
  buttons: { confirmEnabled: boolean; declineEnabled: boolean; blockedReason: string | null },
  waiting: boolean,
): { confirmEnabled: boolean; declineEnabled: boolean; blockedReason: string | null } {
  if (!waiveChecks || !waiting) return buttons
  if (clicker.kind !== 'opc') {
    return {
      confirmEnabled: false,
      declineEnabled: buttons.declineEnabled,
      blockedReason: buttons.blockedReason ?? PLAN_CARD_OPC_ONLY,
    }
  }
  return {
    confirmEnabled: buttons.confirmEnabled,
    declineEnabled: buttons.declineEnabled,
    blockedReason: hardBlock,
  }
}

export function presentCard(args: {
  run: ActionRun
  decisionId: string
  decisionReason: string
  decidedBy: string | null
  clicker: CardClicker
  now: Date
}): ConfirmationCardView {
  const stored = readStoredCard(args.run.input)
  if (!stored || args.run.client_id.length === 0) {
    throw new ConfirmationCardError('invalid', '这张卡的内容读不出来，没有当成已确认。')
  }
  const status = classifyStatus(args.run.status, args.decisionReason, stored.issuedAt, args.now)
  const hardBlock = confirmBlockReason(stored.hardChecks)
  const waiveChecks = planCardMayConfirmDespiteChecks(stored)
  const buttons = buttonsFor(args.clicker, args.run.client_id, waiveChecks ? null : hardBlock, status === 'waiting')
  const click = shownButtons(waiveChecks, args.clicker, hardBlock, buttons, status === 'waiting')
  return {
    runId: args.run.id,
    expectedDecisionId: args.decisionId,
    fingerprint: stored.fingerprint,
    what: stored.what,
    account: stored.account,
    amount: stored.amount,
    date: stored.date,
    scope: stored.scope,
    expiresLabel: expiryLabel(stored.issuedAt),
    status,
    statusLine: statusLine(status, args.decidedBy, stored.subjectKey),
    confirmEnabled: click.confirmEnabled,
    declineEnabled: click.declineEnabled,
    blockedReason: click.blockedReason,
  }
}
