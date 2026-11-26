/**
 * What a person sees on the card. No raw payload, no hash on screen.
 */

import type { ActionRun } from '@/lib/kernel/types'
import { endOfNzDayMs, nzToday } from '@/lib/ads-strategy/promo-window'
import type { CardClicker } from './actor'
import { buttonsFor } from './actor'
import { confirmBlockReason, type HardCheck } from './facts'
import { ConfirmationCardError } from './errors'

export const CONFIRMATION_TTL_MS = 30 * 60 * 1000

/** Urgent human cards stay on the 30-minute clock. Daily jobs last until NZ midnight. */
export type CardLifetime = 'urgent_30m' | 'nz_day'

export function cardLifetimeOf(value: unknown): CardLifetime {
  return value === 'nz_day' ? 'nz_day' : 'urgent_30m'
}

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
  readonly lifetime: CardLifetime
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

export function isExpired(issuedAt: string, now: Date, lifetime: CardLifetime = 'urgent_30m'): boolean {
  const issued = Date.parse(issuedAt)
  if (!Number.isFinite(issued)) return true
  if (lifetime === 'nz_day') return now.getTime() > endOfNzDayMs(nzToday(issued))
  return now.getTime() - issued >= CONFIRMATION_TTL_MS
}

export function expiryLabel(issuedAt: string, lifetime: CardLifetime = 'urgent_30m'): string {
  const issued = Date.parse(issuedAt)
  if (!Number.isFinite(issued)) return '这张卡的时间读不出来。'
  const at = lifetime === 'nz_day'
    ? new Date(endOfNzDayMs(nzToday(issued)))
    : new Date(issued + CONFIRMATION_TTL_MS)
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
  const lifetime = cardLifetimeOf(input.lifetime)
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
  return { subjectKey, fingerprint, what, account, amount, date, scope, issuedAt, hardChecks, lifetime }
}

export function classifyStatus(
  runStatus: string,
  reason: string,
  issuedAt: string,
  now: Date,
  lifetime: CardLifetime = 'urgent_30m',
): CardStatus {
  if (runStatus === 'authorized') return 'confirmed'
  if (runStatus === 'pending_approval') return isExpired(issuedAt, now, lifetime) ? 'expired' : 'waiting'
  if (reason.includes('过了 30 分钟') || reason.includes('过了当天新西兰时间')) return 'expired'
  if (reason.includes('内容变了')) return 'voided'
  return 'declined'
}

function statusLine(status: CardStatus, decidedBy: string | null, lifetime: CardLifetime): string {
  if (status === 'waiting') return '还没人点。'
  if (status === 'confirmed') return `${decidedBy ?? '有人'} 点了确认。这件事还没有开始做。`
  if (status === 'declined') return `${decidedBy ?? '有人'} 点了不做。`
  if (status === 'expired' && lifetime === 'nz_day') return '过了当天新西兰时间 23:59 没人点，这张卡作废了。'
  if (status === 'expired') return '过了 30 分钟没人点，这张卡作废了。'
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
  const status = classifyStatus(args.run.status, args.decisionReason, stored.issuedAt, args.now, stored.lifetime)
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
    expiresLabel: expiryLabel(stored.issuedAt, stored.lifetime),
    status,
    statusLine: statusLine(status, args.decidedBy, stored.lifetime),
    confirmEnabled: buttons.confirmEnabled,
    declineEnabled: buttons.declineEnabled,
    blockedReason: buttons.blockedReason,
  }
}
