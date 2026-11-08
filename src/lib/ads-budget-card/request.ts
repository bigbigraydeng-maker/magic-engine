/** One ad set per request. The prescription must already be approved. */

import { ConfirmationCardError } from '@/lib/confirmation-card/errors'
import { isValidAdsMetricKey } from '@/lib/flywheel/vocabulary'
import { isUuid } from '@/lib/validation-utils'
import type { BudgetOrder, MetricDirection } from './types'

const KEYS = [
  'prescriptionId',
  'adsetId',
  'adAccountId',
  'newDailyBudgetCents',
  'name',
  'expectedMetric',
  'direction',
  'observationWindowDays',
]
const ADSET_RE = /^\d{1,32}$/
const ACCOUNT_RE = /^act_\d{6,20}$/

export function parseBudgetRequest(value: unknown): BudgetOrder {
  const row = asRow(value)
  rejectExtra(row)
  const prescriptionId = requireUuid(row.prescriptionId, '处方编号不对，没有出卡。')
  const adsetId = requireId(row.adsetId, ADSET_RE, '广告组编号不对，没有出卡。')
  const adAccountId = requireId(row.adAccountId, ACCOUNT_RE, '广告账户编号不对，没有出卡。')
  if (!Number.isSafeInteger(row.newDailyBudgetCents) || (row.newDailyBudgetCents as number) <= 0) {
    throw new ConfirmationCardError('invalid', '新的日预算不是有效金额，没有出卡。')
  }
  const expectedMetric = requireMetric(row.expectedMetric)
  const direction = requireDirection(row.direction)
  const observationWindowDays = requireWindow(row.observationWindowDays)
  return {
    prescriptionId,
    adsetId,
    adAccountId,
    newDailyBudgetCents: row.newDailyBudgetCents as number,
    name: optionalName(row.name),
    expectedMetric,
    direction,
    observationWindowDays,
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

function requireMetric(value: unknown): string {
  if (typeof value !== 'string' || !isValidAdsMetricKey(value)) {
    throw new ConfirmationCardError('invalid', '要观察的指标不在已有的广告指标里，没有出卡。')
  }
  return value
}

function requireDirection(value: unknown): MetricDirection {
  if (value !== 'up' && value !== 'down') {
    throw new ConfirmationCardError('invalid', '指标方向只能是升高或降低，没有出卡。')
  }
  return value
}

function requireWindow(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > 28) {
    throw new ConfirmationCardError('invalid', '观察天数要在 1 到 28 天里，没有出卡。')
  }
  return value as number
}

function requireUuid(value: unknown, reason: string): string {
  if (!isUuid(value)) throw new ConfirmationCardError('invalid', reason)
  return value
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
