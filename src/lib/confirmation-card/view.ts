/**
 * What a person sees on the card. No raw payload, no hash on screen.
 */

import type { ActionRun } from '@/lib/kernel/types'
import type { CardClicker } from './actor'
import { buttonsFor } from './actor'
import { confirmBlockReason, type HardCheck } from './facts'
import { ConfirmationCardError } from './errors'

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
  readonly expiresAt: string | null
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

export function isExpired(issuedAt: string, now: Date, expiresAt?: string | null): boolean {
  if (expiresAt) {
    const end = Date.parse(expiresAt)
    return !Number.isFinite(end) || now.getTime() >= end
  }
  const issued = Date.parse(issuedAt)
  if (!Number.isFinite(issued)) return true
  return now.getTime() - issued >= CONFIRMATION_TTL_MS
}

export function expiryLabel(issuedAt: string, expiresAt?: string | null): string {
  const end = expiresAt ? Date.parse(expiresAt) : Date.parse(issuedAt) + CONFIRMATION_TTL_MS
  const at = new Date(Number.isFinite(end) ? end - (expiresAt ? 1 : 0) : Date.parse(issuedAt))
  const text = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Pacific/Auckland',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    ...(expiresAt ? { second: '2-digit' as const } : {}),
    hour12: false,
  }).format(at)
  const tail = expiresAt ? '过了新西兰当天就作废。' : '过了要重新出一张。'
  return `请在 ${text}（新西兰时间）前点。${tail}`
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
  const expiresAt = asString(input.expires_at)
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
  return { subjectKey, fingerprint, what, account, amount, date, scope, issuedAt, expiresAt, hardChecks }
}

export function classifyStatus(
  runStatus: string, reason: string, issuedAt: string, now: Date, expiresAt?: string | null,
): CardStatus {
  if (runStatus === 'authorized') return 'confirmed'
  if (runStatus === 'pending_approval') return isExpired(issuedAt, now, expiresAt) ? 'expired' : 'waiting'
  if (reason.includes('过了 30 分钟') || reason.includes('过了新西兰当天')) return 'expired'
  if (reason.includes('内容变了')) return 'voided'
  return 'declined'
}

function statusLine(status: CardStatus, decidedBy: string | null, expiresAt?: string | null): string {
  if (status === 'waiting') return '还没人点。'
  if (status === 'confirmed') return `${decidedBy ?? '有人'} 点了确认。这件事还没有开始做。`
  if (status === 'declined') return `${decidedBy ?? '有人'} 点了不做。`
  if (status === 'expired') {
    return expiresAt ? '过了新西兰当天没人点，这张卡作废了。' : '过了 30 分钟没人点，这张卡作废了。'
  }
  return '要做的事变了，这张旧卡作废了。'
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
  const status = classifyStatus(args.run.status, args.decisionReason, stored.issuedAt, args.now, stored.expiresAt)
  const hardBlock = confirmBlockReason(stored.hardChecks)
  const buttons = buttonsFor(args.clicker, args.run.client_id, hardBlock, status === 'waiting')
  return {
    runId: args.run.id,
    expectedDecisionId: args.decisionId,
    fingerprint: stored.fingerprint,
    what: stored.what,
    account: stored.account,
    amount: stored.amount,
    date: stored.date,
    scope: stored.scope,
    expiresLabel: expiryLabel(stored.issuedAt, stored.expiresAt),
    status,
    statusLine: statusLine(status, args.decidedBy, stored.expiresAt),
    confirmEnabled: buttons.confirmEnabled,
    declineEnabled: buttons.declineEnabled,
    blockedReason: buttons.blockedReason,
  }
}
