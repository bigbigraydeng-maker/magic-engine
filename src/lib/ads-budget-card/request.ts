/** One ad set per request. Extra fields and lists are refused. */

import { ConfirmationCardError } from '@/lib/confirmation-card/errors'
import type { BudgetOrder } from './types'

const KEYS = ['adsetId', 'adAccountId', 'newDailyBudgetCents', 'name']
const ADSET_RE = /^\d{1,32}$/
const ACCOUNT_RE = /^act_\d{6,20}$/

export function parseBudgetRequest(value: unknown): BudgetOrder {
  const row = asRow(value)
  rejectExtra(row)
  const adsetId = requireId(row.adsetId, ADSET_RE, '广告组编号不对，没有出卡。')
  const adAccountId = requireId(row.adAccountId, ACCOUNT_RE, '广告账户编号不对，没有出卡。')
  if (!Number.isSafeInteger(row.newDailyBudgetCents) || (row.newDailyBudgetCents as number) <= 0) {
    throw new ConfirmationCardError('invalid', '新的日预算不是有效金额，没有出卡。')
  }
  return {
    adsetId,
    adAccountId,
    newDailyBudgetCents: row.newDailyBudgetCents as number,
    name: optionalName(row.name),
  }
}

function asRow(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ConfirmationCardError('invalid', '一张卡只能改一个广告组。')
  }
  return value as Record<string, unknown>
}

function rejectExtra(row: Record<string, unknown>): void {
  if ('adsetIds' in row || 'adsets' in row || Array.isArray(row.adsetId)) {
    throw new ConfirmationCardError('invalid', '一张卡只能改一个广告组。')
  }
  for (const key of Object.keys(row)) {
    if (!KEYS.includes(key)) {
      throw new ConfirmationCardError('invalid', '请求里带了这张卡不认识的内容，没有收下。')
    }
  }
}

function requireId(value: unknown, pattern: RegExp, reason: string): string {
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw new ConfirmationCardError('invalid', reason)
  }
  return value
}

function optionalName(value: unknown): string | null {
  if (value == null) return null
  if (typeof value !== 'string' || /[{}[\]`]/.test(value) || value.trim().length > 40) {
    throw new ConfirmationCardError('invalid', '广告组的名字请用一句短人话。')
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}
