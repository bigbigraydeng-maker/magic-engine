/**
 * One existing ad. A budget field is refused.
 * The id is an obvious stand-in shape, never a live account number.
 */

import { ConfirmationCardError } from '@/lib/confirmation-card/errors'

export interface ActivateOrder {
  readonly adId: string
}

const KEYS = ['adId']
const AD_RE = /^\d{6,20}$/

export function parseActivateRequest(value: unknown): ActivateOrder {
  const row = asRow(value)
  rejectExtra(row)
  return { adId: match(row.adId, AD_RE, '广告编号不对，没有出卡。') }
}

function asRow(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ConfirmationCardError('invalid', '一张卡只能打开一条广告。')
  }
  return value as Record<string, unknown>
}

function rejectExtra(row: Record<string, unknown>): void {
  for (const key of Object.keys(row)) {
    if (!KEYS.includes(key)) throw new ConfirmationCardError('invalid', '请求里带了这张卡不认识的内容，没有收下。')
  }
}

function match(value: unknown, pattern: RegExp, reason: string): string {
  if (typeof value !== 'string' || !pattern.test(value)) throw new ConfirmationCardError('invalid', reason)
  return value
}
