/**
 * Map the ten pre-launch gates onto a confirmation card.
 * The card holds at most eight checks, so a fully green set is one line,
 * and only the problems are listed when something is not green.
 * Yellow is not green. Grey, stale, and missing are unreadable, never green.
 */

import { GATE_LABELS } from '@/lib/ads-tracking-preflight/judge'
import {
  BUDGET_RECEIPT_STALE_HOURS,
  receiptIsStale,
  TRACKING_RECEIPT_STALE_HOURS,
} from '@/lib/ads-tracking-preflight/receipt'
import { PREFLIGHT_GATE_KEYS, type PreflightGateKey } from '@/lib/ads-tracking-preflight/types'
import type { HardCheck } from '@/lib/confirmation-card'
import { plainClip } from './text'

const BUDGET_KEY: PreflightGateKey = 'env.account_billing'
const LIGHTS = new Set(['green', 'yellow', 'red', 'gray'])

export interface GoLiveGate {
  readonly key: PreflightGateKey
  readonly status: 'green' | 'yellow' | 'red' | 'gray' | 'missing'
  readonly reason: string
  readonly na: boolean
  readonly stale: boolean
}

export interface StoredGate {
  readonly key: string
  readonly status: string
  readonly reason: string
  readonly na?: boolean
}

function isLight(value: string): value is 'green' | 'yellow' | 'red' | 'gray' {
  return LIGHTS.has(value)
}

export function gatesFromReceipt(input: {
  readonly receipt: { checkedAt: string; gates: readonly StoredGate[] } | null
  readonly now: Date
}): GoLiveGate[] {
  return PREFLIGHT_GATE_KEYS.map((key) => {
    const found = input.receipt?.gates.find((gate) => gate.key === key) ?? null
    if (!found || !input.receipt) {
      return { key, status: 'missing', reason: '', na: false, stale: false }
    }
    const limit = key === BUDGET_KEY ? BUDGET_RECEIPT_STALE_HOURS : TRACKING_RECEIPT_STALE_HOURS
    const status = isLight(found.status) ? found.status : 'missing'
    return {
      key,
      status,
      reason: found.reason,
      na: found.na === true,
      stale: receiptIsStale(input.receipt.checkedAt, input.now, limit),
    }
  })
}

function oneGate(gate: GoLiveGate): HardCheck | null {
  if (gate.na) return null
  const label = GATE_LABELS[gate.key]
  if (gate.status === 'missing') return { label, state: 'unread', reason: '这道检查没有结果' }
  if (gate.stale) return { label, state: 'unread', reason: '这道检查的结果过期了' }
  if (gate.status === 'green') return { label, state: 'green', reason: plainClip(gate.reason) }
  if (gate.status === 'gray') {
    return { label, state: 'unread', reason: plainClip(gate.reason) || '读不到' }
  }
  return { label, state: 'red', reason: plainClip(gate.reason) || '还不是绿灯' }
}

function pack(problems: readonly HardCheck[]): HardCheck[] {
  if (problems.length <= 8) return [...problems]
  const rest = problems.slice(7)
  const joined = plainClip(rest.map((item) => `${item.label}：${item.reason || '没通过'}`).join('；'))
  const state = rest.some((item) => item.state === 'red') ? 'red' : 'unread'
  return [
    ...problems.slice(0, 7),
    { label: '还有没通过的检查', state, reason: joined || `还有 ${rest.length} 道没通过` },
  ]
}

export function hardChecksForGoLive(
  gates: readonly GoLiveGate[],
  extras: readonly HardCheck[],
): HardCheck[] {
  const rows = gates.map(oneGate).filter((row): row is HardCheck => row !== null)
  const problems = [...rows.filter((row) => row.state !== 'green'), ...extras]
  if (rows.length === 0) {
    return pack([
      { label: '开投前十道检查', state: 'unread', reason: '现在读不到检查结果' },
      ...extras,
    ])
  }
  if (problems.length === 0) {
    const allTen = rows.length === PREFLIGHT_GATE_KEYS.length
    return [{
      label: '开投前十道检查',
      state: 'green',
      reason: allTen ? '十道都是绿灯' : '适用的检查都是绿灯',
    }]
  }
  return pack(problems)
}
