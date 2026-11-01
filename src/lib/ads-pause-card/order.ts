/**
 * Pause orders read from an approved plan or prescription.
 * A missing basis or metric is a block. Nothing is filled in.
 */

import { canonicalHashOfInput } from '@/lib/kernel/canonical-hash'
import { isAdsMetricPulled } from '@/lib/flywheel/metric-registry'

export type PauseLevel = 'ad_set' | 'ad'
export type PauseSourceKind = 'plan_step' | 'prescription'

export interface PauseOrder {
  readonly sourceKind: PauseSourceKind
  readonly sourceId: string
  readonly stepId: string
  readonly level: PauseLevel
  readonly adAccountId: string
  readonly campaignId: string
  readonly adsetId: string
  readonly adId: string | null
  readonly basis: string
  readonly expectedMetric: string
  readonly successorAdId: string | null
}

export interface PauseBlock {
  readonly stepId: string
  readonly reason: string
}

export interface LiveAd {
  readonly id: string
  readonly adsetId: string
  readonly effectiveStatus: string | null
}

const ID_RE = /^(?:act_)?\d{1,32}$/
const OBJECT_ID_RE = /^\d{1,32}$/
const PLACEHOLDER = /^(待定|待补充|待填写|未知|暂无|无|默认|tbd|n\/a|na|todo|placeholder|—|-)$/i
const FORBIDDEN = ['status', 'new_status', 'daily_budget', 'daily_budget_cents', 'budget', 'budget_cents', 'activate', 'enabled', 'new_daily_budget']

export function orderKey(order: PauseOrder): string {
  return canonicalHashOfInput({
    sourceKind: order.sourceKind,
    sourceId: order.sourceId,
    stepId: order.stepId,
    level: order.level,
    adAccountId: order.adAccountId,
    campaignId: order.campaignId,
    adsetId: order.adsetId,
    adId: order.adId,
    successorAdId: order.successorAdId,
    basis: order.basis,
    expectedMetric: order.expectedMetric,
  })
}

export function extractPauseOrders(
  sourceKind: PauseSourceKind,
  sourceId: string,
  status: unknown,
  body: unknown,
): { orders: PauseOrder[]; blocked: PauseBlock[] } {
  if (status !== 'approved') return { orders: [], blocked: [] }
  const orders: PauseOrder[] = []
  const blocked: PauseBlock[] = []
  for (const raw of candidates(body)) {
    const parsed = parseOrder(sourceKind, sourceId, raw)
    if (parsed.ok) orders.push(parsed.order)
    else if (parsed.reason) blocked.push({ stepId: parsed.stepId, reason: parsed.reason })
  }
  return { orders, blocked }
}

function candidates(body: unknown): unknown[] {
  const root = record(body)
  if (!root) return []
  const found: unknown[] = []
  pushList(found, root.ad_pause_orders)
  const promo = record(root.promo)
  const phases = Array.isArray(promo?.phases) ? promo.phases : Array.isArray(root.phases) ? root.phases : []
  for (const phase of phases) {
    const steps = Array.isArray(record(phase)?.steps) ? record(phase)?.steps as unknown[] : []
    const actions = Array.isArray(record(phase)?.actions) ? record(phase)?.actions as unknown[] : []
    for (const step of [...steps, ...actions]) found.push(...unwrap(step))
  }
  return found
}

function unwrap(step: unknown): unknown[] {
  const row = record(step)
  if (!row) return []
  const nested = record(record(row.settings)?.pause_object) ?? record(row.pause_object)
  if (nested) return [{ ...nested, step_id: text(row.id) ?? text(row.step_id) ?? text(nested.step_id) }]
  if (row.kind === 'ads_pause' || isPauseType(row.action_type) || row.level === 'ad' || row.level === 'ad_set') {
    return [row]
  }
  return []
}

function parseOrder(
  sourceKind: PauseSourceKind,
  sourceId: string,
  raw: unknown,
): { ok: true; order: PauseOrder } | { ok: false; stepId: string; reason: string | null } {
  const row = record(raw)
  if (!row) return { ok: false, stepId: '', reason: null }
  const stepId = text(row.step_id) ?? text(row.id) ?? ''
  if (!looksLikePause(row)) return { ok: false, stepId, reason: null }
  const forbidden = FORBIDDEN.find((key) => key in row)
  if (forbidden) return { ok: false, stepId, reason: '这张卡不能用来开启或改预算。' }
  const level = levelOf(row)
  if (!level) return { ok: false, stepId, reason: '只能暂停广告组或单条广告。' }
  const ids = readIds(row, level)
  if (!ids.ok) return { ok: false, stepId, reason: ids.reason }
  const basis = text(row.basis)
  if (!basis) return { ok: false, stepId, reason: '没有改动依据，没有出卡。' }
  if (PLACEHOLDER.test(basis) || /[{}[\]`]/.test(basis)) {
    return { ok: false, stepId, reason: '改动依据不能用占位词，没有出卡。' }
  }
  const metric = text(row.expected_metric)
  if (!metric) return { ok: false, stepId, reason: '没有预期指标，没有出卡。' }
  if (!isAdsMetricPulled(metric)) return { ok: false, stepId, reason: '预期指标现在量不到，没有出卡。' }
  if (!stepId) return { ok: false, stepId, reason: '没有步骤编号，没有出卡。' }
  const successor = text(row.successor_ad_id)
  if (successor && !OBJECT_ID_RE.test(successor)) return { ok: false, stepId, reason: '新广告编号不对，没有出卡。' }
  return {
    ok: true,
    order: {
      sourceKind, sourceId, stepId, level,
      adAccountId: ids.adAccountId, campaignId: ids.campaignId, adsetId: ids.adsetId, adId: ids.adId,
      basis, expectedMetric: metric, successorAdId: successor,
    },
  }
}

function levelOf(row: Record<string, unknown>): PauseLevel | null {
  if (row.level === 'ad_set' || row.action_type === 'ads.pause_ad_set') return 'ad_set'
  if (row.level === 'ad' || row.action_type === 'ads.pause_ad') return 'ad'
  return null
}

function readIds(row: Record<string, unknown>, level: PauseLevel):
  | { ok: true; adAccountId: string; campaignId: string; adsetId: string; adId: string | null }
  | { ok: false; reason: string } {
  const adAccountId = text(row.ad_account_id) ?? ''
  const campaignId = text(row.campaign_id) ?? ''
  const adsetId = text(row.adset_id) ?? ''
  const adId = text(row.ad_id)
  if (!ID_RE.test(adAccountId) || !OBJECT_ID_RE.test(campaignId) || !OBJECT_ID_RE.test(adsetId)) {
    return { ok: false, reason: '账户、系列或广告组编号不对，没有出卡。' }
  }
  if (level === 'ad' && (!adId || !OBJECT_ID_RE.test(adId))) {
    return { ok: false, reason: '没有要暂停的广告编号，没有出卡。' }
  }
  return { ok: true, adAccountId, campaignId, adsetId, adId: level === 'ad' ? adId : null }
}

function looksLikePause(row: Record<string, unknown>): boolean {
  return isPauseType(row.action_type) || row.kind === 'ads_pause' || row.level === 'ad' || row.level === 'ad_set'
}

function isPauseType(value: unknown): boolean {
  return value === 'ads.pause_ad' || value === 'ads.pause_ad_set'
}

function pushList(found: unknown[], value: unknown): void {
  if (Array.isArray(value)) found.push(...value)
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}
