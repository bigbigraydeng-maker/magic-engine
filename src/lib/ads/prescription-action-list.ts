/**
 * Machine-readable ads actions embedded in prescriptions.content (AD-2).
 * At most one pause and one budget adjustment per prescription.
 * Approval issues confirm cards from this list and does not execute them.
 */

import { z } from 'zod'
import { ADS_ACTION_TYPE } from '@/lib/flywheel/vocabulary'
import { ADS_METRIC_KEY } from '@/lib/flywheel/vocabulary'
import { isAdsMetricPulled } from '@/lib/flywheel/metric-registry'

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/
const PLACEHOLDER = /^(待定|待补充|待填写|未知|暂无|无|默认|tbd|n\/a|na|todo|placeholder|—|-)$/i

const targetSchema = z.object({
  ad_account_id: z.string().trim().regex(ID_RE, 'ad_account_id 格式不对'),
  campaign_id: z.string().trim().regex(ID_RE, 'campaign_id 格式不对'),
  adset_id: z.string().trim().regex(ID_RE, 'adset_id 格式不对'),
})

const pauseItemSchema = z.object({
  type: z.literal(ADS_ACTION_TYPE.PAUSE_AD_SET),
  target: targetSchema,
  reason: z.string().trim().min(1).max(2_000).refine((s) => !PLACEHOLDER.test(s) && !/[{}[\]`]/.test(s), 'reason 不可为占位或含非法字符'),
  observation_days: z.number().int().min(1).max(28),
  metric: z.string().trim().min(1).refine(isAdsMetricPulled, 'metric 必须是已拉取的 ads 指标'),
  direction: z.literal('pause').optional(),
})

const budgetItemSchema = z.object({
  type: z.literal(ADS_ACTION_TYPE.ADJUST_ADSET_DAILY_BUDGET),
  target: targetSchema,
  reason: z.string().trim().min(1).max(2_000).refine((s) => !PLACEHOLDER.test(s), 'reason 不可为占位'),
  observation_days: z.number().int().min(1).max(28),
  proposed_daily_budget_cents: z.number().int().positive().max(9_999_999),
  direction: z.enum(['up', 'down']).optional(),
  expected_metric: z.string().trim().min(1).refine(isAdsMetricPulled, 'expected_metric 必须是已拉取的 ads 指标').optional(),
})

const actionItemSchema = z.discriminatedUnion('type', [pauseItemSchema, budgetItemSchema])

export type PrescriptionPauseAction = z.infer<typeof pauseItemSchema>
export type PrescriptionBudgetAction = z.infer<typeof budgetItemSchema>
export type PrescriptionActionListItem = z.infer<typeof actionItemSchema>

export interface PrescriptionActionList {
  readonly items: readonly PrescriptionActionListItem[]
}

export type ActionListNormalizeResult =
  | { ok: true; action_list: PrescriptionActionListItem[]; dropped_reason: string | null }
  | { ok: false; reason: string }

export function parsePrescriptionActionList(raw: unknown): ActionListNormalizeResult {
  if (raw === undefined || raw === null) {
    return { ok: true, action_list: [], dropped_reason: null }
  }
  if (!Array.isArray(raw)) {
    return { ok: false, reason: 'action_list 必须是数组' }
  }
  const parsed: PrescriptionActionListItem[] = []
  for (let i = 0; i < raw.length; i += 1) {
    const row = actionItemSchema.safeParse(raw[i])
    if (!row.success) {
      const msg = row.error.issues[0]?.message ?? '形状不对'
      return { ok: false, reason: `action_list 第 ${i + 1} 条无效：${msg}` }
    }
    parsed.push(row.data)
  }
  const capped = capPauseAndBudget(parsed)
  return { ok: true, action_list: capped.items, dropped_reason: capped.droppedReason }
}

function capPauseAndBudget(items: PrescriptionActionListItem[]): {
  items: PrescriptionActionListItem[]
  droppedReason: string | null
} {
  let pauseKept = false
  let budgetKept = false
  const kept: PrescriptionActionListItem[] = []
  let dropped = 0
  for (const item of items) {
    if (item.type === ADS_ACTION_TYPE.PAUSE_AD_SET) {
      if (pauseKept) { dropped += 1; continue }
      pauseKept = true
      kept.push(item)
      continue
    }
    if (item.type === ADS_ACTION_TYPE.ADJUST_ADSET_DAILY_BUDGET) {
      if (budgetKept) { dropped += 1; continue }
      budgetKept = true
      kept.push(item)
    }
  }
  if (dropped === 0) return { items: kept, droppedReason: null }
  return {
    items: kept,
    droppedReason: `处方动作列表最多一条暂停（${ADS_ACTION_TYPE.PAUSE_AD_SET}）和一条调预算（${ADS_ACTION_TYPE.ADJUST_ADSET_DAILY_BUDGET}）；已丢弃多余 ${dropped} 条。`,
  }
}

export function finalizePrescriptionActionList<T extends { action_list?: unknown; pause_ad_set?: unknown }>(
  content: T,
): { content: T & { action_list?: PrescriptionActionListItem[] }; action_list_dropped_reason: string | null } {
  if (!('action_list' in content) || content.action_list === undefined) {
    return { content, action_list_dropped_reason: null }
  }
  const parsed = parsePrescriptionActionList(content.action_list)
  if (!parsed.ok) {
    const next = { ...content }
    delete next.action_list
    return { content: next, action_list_dropped_reason: null }
  }
  const next = { ...content, action_list: parsed.action_list } as T & { action_list?: PrescriptionActionListItem[] }
  if (parsed.action_list.length === 0) {
    delete (next as { action_list?: unknown }).action_list
    return { content: next, action_list_dropped_reason: parsed.dropped_reason }
  }
  const pause = parsed.action_list.find((a) => a.type === ADS_ACTION_TYPE.PAUSE_AD_SET)
  if (pause && next.pause_ad_set === undefined) {
    next.pause_ad_set = legacyPauseBlob(pause)
  }
  return { content: next, action_list_dropped_reason: parsed.dropped_reason }
}

/** Normalize action_list on prescription content. Approval reads the saved list later. */
export function attachPrescriptionActionList<T extends { action_list?: unknown; pause_ad_set?: unknown }>(
  content: T,
): T & { action_list?: PrescriptionActionListItem[] } {
  return finalizePrescriptionActionList(content).content
}

function legacyPauseBlob(pause: PrescriptionPauseAction): Record<string, unknown> {
  return {
    ad_account_id: pause.target.ad_account_id,
    campaign_id: pause.target.campaign_id,
    adset_id: pause.target.adset_id,
    metric: pause.metric,
    direction: 'pause',
    observation_days: pause.observation_days,
    basis: pause.reason,
  }
}

/** Test helper: minimal valid pause row with fake entity ids. */
export function fakePauseAction(over: Partial<PrescriptionPauseAction> = {}): PrescriptionPauseAction {
  return {
    type: ADS_ACTION_TYPE.PAUSE_AD_SET,
    target: {
      ad_account_id: 'act_FAKE_A',
      campaign_id: 'camp_FAKE_A',
      adset_id: 'adset_FAKE_A',
    },
    reason: '测试：这一组花钱但没有结果',
    observation_days: 7,
    metric: ADS_METRIC_KEY.SPEND,
    ...over,
  }
}

/** Test helper: minimal valid budget row with fake entity ids and cents. */
export function fakeBudgetAction(over: Partial<PrescriptionBudgetAction> = {}): PrescriptionBudgetAction {
  return {
    type: ADS_ACTION_TYPE.ADJUST_ADSET_DAILY_BUDGET,
    target: {
      ad_account_id: 'act_FAKE_B',
      campaign_id: 'camp_FAKE_B',
      adset_id: 'adset_FAKE_B',
    },
    reason: '测试：日预算建议下调',
    observation_days: 7,
    proposed_daily_budget_cents: 8_800,
    direction: 'down',
    expected_metric: ADS_METRIC_KEY.SPEND,
    ...over,
  }
}
