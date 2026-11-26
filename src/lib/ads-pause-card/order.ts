/**
 * One approved prescription may name one ad set to pause.
 * Anything that would resume or change a budget is refused.
 */

import { canonicalHashOfInput } from '@/lib/kernel/canonical-hash'
import { isAdsMetricPulled } from '@/lib/flywheel/metric-registry'

export interface PauseAdSetOrder {
  readonly prescriptionId: string
  readonly version: number
  readonly adAccountId: string
  readonly campaignId: string
  readonly adsetId: string
  readonly metric: string
  readonly direction: 'pause'
  readonly observationDays: number
  readonly basis: string
}

const PLACEHOLDER = /^(待定|待补充|待填写|未知|暂无|无|默认|tbd|n\/a|na|todo|placeholder|—|-)$/i
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/
const FORBIDDEN = [
  'status', 'new_status', 'activate', 'resume', 'enabled',
  'daily_budget', 'daily_budget_cents', 'budget', 'budget_cents', 'new_daily_budget',
]

export function orderKey(order: PauseAdSetOrder): string {
  return canonicalHashOfInput({ ...order })
}

export function readPauseOrder(
  prescriptionId: string,
  version: number,
  content: unknown,
): { ok: true; order: PauseAdSetOrder } | { ok: false; reason: string | null } {
  const root = record(content)
  if (!root || !('pause_ad_set' in root)) return { ok: false, reason: null }
  if (Array.isArray(root.pause_ad_set)) return { ok: false, reason: '一份处方只能暂停一个广告组。' }
  const row = record(root.pause_ad_set)
  if (!row) return { ok: false, reason: '暂停广告组的内容读不懂，没有出卡。' }
  return parseRow(prescriptionId, version, row)
}

function parseRow(
  prescriptionId: string,
  version: number,
  row: Record<string, unknown>,
): { ok: true; order: PauseAdSetOrder } | { ok: false; reason: string | null } {
  if (FORBIDDEN.some((key) => key in row)) return { ok: false, reason: '这张卡不能用来开启或改预算。' }
  if (row.direction !== 'pause') return { ok: false, reason: '这张卡只接受暂停，不会开启。' }
  const ids = readIds(row)
  const basis = text(row.basis)
  const metric = text(row.metric)
  const days = row.observation_days
  if (!ids) return { ok: false, reason: '账户、系列或广告组没有写清，没有出卡。' }
  if (!basis || PLACEHOLDER.test(basis) || /[{}[\]`]/.test(basis)) {
    return { ok: false, reason: '没有能看懂的暂停依据，没有出卡。' }
  }
  if (!metric || !isAdsMetricPulled(metric)) return { ok: false, reason: '预期指标现在量不到，没有出卡。' }
  if (typeof days !== 'number' || !Number.isInteger(days) || days < 1 || days > 28) {
    return { ok: false, reason: '观察天数要写在 1 到 28 天之间，没有出卡。' }
  }
  if (!Number.isInteger(version) || version < 1) return { ok: false, reason: '处方版本不对，没有出卡。' }
  return { ok: true, order: { prescriptionId, version, ...ids, metric, direction: 'pause', observationDays: days, basis } }
}

function readIds(row: Record<string, unknown>): Pick<PauseAdSetOrder, 'adAccountId' | 'campaignId' | 'adsetId'> | null {
  const adAccountId = text(row.ad_account_id)
  const campaignId = text(row.campaign_id)
  const adsetId = text(row.adset_id)
  if (!adAccountId || !campaignId || !adsetId) return null
  if (![adAccountId, campaignId, adsetId].every((id) => ID_RE.test(id))) return null
  return { adAccountId, campaignId, adsetId }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}
