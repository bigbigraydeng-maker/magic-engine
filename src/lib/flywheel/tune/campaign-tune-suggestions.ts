/**
 * Social Tune v1 — 批量建议生成（Gate B 步骤 3 支撑函数）。
 *
 * 输入是**内存里的数据**（actions + receipts）—— route 一次性拉齐后交给这里做 fan-out：
 * 对每条 action 都当一次 target，其它 T+72 receipt 组成 cohort，跑 Gate B/1 的 evaluator。
 *
 * 为什么不用 loadPostCohort 循环调用：
 *   单页展示可能有 5–7 条 published post。用 loadPostCohort 就是 5–7 × 2 = 10 多次
 *   DB 往返，且每次都重复拉几乎相同的 action 列表。route 拉一次、这里内存里 fan-out，
 *   把 DB 压力压到 O(1)。
 *
 * 无 I/O、无客户名 / 行业词硬编码、无副作用。cohort 的「同客户 + 同活动」过滤是**调用方**
 * （route）的责任 —— 本函数只对入参做批量循环，不知道客户是谁。
 */

import { evaluateSocialPost } from './social-post-evaluator'
import type {
  PostMeasurement,
  PostMeasurementStatus,
  PostMetricField,
  TuneRecommendation,
  TuneThresholds,
} from './types'

const T72_WINDOW_HOURS = 72
const PRIMARY_METRIC_FIELDS: readonly PostMetricField[] = ['likes', 'comments', 'shares']

/** action 行的最小形状 —— route 从 flywheel_actions 读的字段。 */
export interface CampaignActionRow {
  id:      string
  /**
   * 用作 map key = 发布回执里的 idempotency_key（UI 侧 CampaignDailyPublishPanel.publishedPosts[].idempotency_key）。
   * 不用 post_id：排期帖回执存的是照片编号，动作行存的是解析后的帖子编号，两边对不上。
   */
  idempotencyKey: string
}

/** receipt 行的最小形状 —— route 从 social_post_measurement_receipts 读的字段。 */
export interface CampaignReceiptRow {
  actionId:    string
  windowHours: number
  status:      string
  values:      unknown
  missing:     unknown
}

export interface CampaignTuneInput {
  actions:     CampaignActionRow[]
  receipts:    CampaignReceiptRow[]
  thresholds?: Partial<TuneThresholds>
}

/**
 * key 是发布回执的 idempotency_key，value 是建议或 null。
 *
 * null = 这条 action 连自己的 T+72 receipt 都还没有（未到点 / 不可测未落 unmeasurable 行）
 *        —— UI 用「等 T+72 到点再看」的占位文案渲染。
 * INCONCLUSIVE = 有 receipt，但 cohort 不够 / target 不可测 / 无共同主指标 / target 是 T+4。
 */
export type CampaignTuneSuggestions = Record<string, TuneRecommendation | null>

export function evaluateCampaignPosts(input: CampaignTuneInput): CampaignTuneSuggestions {
  const t72Receipts = input.receipts.filter((r) => r.windowHours === T72_WINDOW_HOURS)

  const receiptByAction = new Map<string, CampaignReceiptRow>()
  for (const r of t72Receipts) receiptByAction.set(r.actionId, r)

  const out: CampaignTuneSuggestions = {}
  for (const action of input.actions) {
    const targetReceipt = receiptByAction.get(action.id)
    if (!targetReceipt) {
      out[action.idempotencyKey] = null
      continue
    }
    const cohortReceipts = t72Receipts.filter((r) => r.actionId !== action.id)
    const rec = evaluateSocialPost({
      target: toMeasurement(action.id, targetReceipt),
      cohort: cohortReceipts.map((r) => toMeasurement(r.actionId, r)),
      thresholds: input.thresholds,
    })
    out[action.idempotencyKey] = rec
  }
  return out
}

// ── 归一化 ────────────────────────────────────────────────────────────────

function toMeasurement(actionId: string, row: CampaignReceiptRow): PostMeasurement {
  return {
    actionId,
    windowHours: row.windowHours,
    status:      normalizeStatus(row.status),
    values:      parseNumberMap(row.values),
    missing:     parseStringMap(row.missing),
  }
}

function normalizeStatus(raw: string): PostMeasurementStatus {
  // 与 social-post-cohort.normalizeStatus 同源：新 status 出现时留声，防止静默丢数据。
  if (raw === 'ok' || raw === 'partial' || raw === 'unmeasurable') return raw
  console.warn(`[campaign-tune-suggestions] unknown receipt status '${raw}' — downgrading to unmeasurable`)
  return 'unmeasurable'
}

function parseNumberMap(raw: unknown): Partial<Record<PostMetricField, number>> {
  if (!raw || typeof raw !== 'object') return {}
  const source = raw as Record<string, unknown>
  const out: Partial<Record<PostMetricField, number>> = {}
  for (const k of PRIMARY_METRIC_FIELDS) {
    const v = source[k]
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v
  }
  return out
}

function parseStringMap(raw: unknown): Partial<Record<PostMetricField, string>> {
  if (!raw || typeof raw !== 'object') return {}
  const source = raw as Record<string, unknown>
  const out: Partial<Record<PostMetricField, string>> = {}
  for (const k of PRIMARY_METRIC_FIELDS) {
    const v = source[k]
    if (typeof v === 'string' && v.length > 0) out[k] = v
  }
  return out
}
