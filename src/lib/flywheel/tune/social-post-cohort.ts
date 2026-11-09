/**
 * Social Tune v1 — cohort 拉取（Gate B 步骤 2，读侧）。
 *
 * 从生产两张表拉出「同客户 + 同活动 + T+72」的可比历史帖子，喂给 evaluator。
 *   1. flywheel_actions   —— 拿到候选 action id（受 daily_plan source 过滤）
 *   2. social_post_measurement_receipts —— 只要 T+72 窗口
 *
 * 分两步查而不做 JOIN：Supabase 的嵌套 select 会走 PostgREST 的隐式外键关系，
 * 一旦哪张表的 RLS 变更就静默返回空集。这里的过滤本身很轻，两次往返换来可读性
 * 与显式的 RLS 边界。
 *
 * 硬边界：
 *   - 只处理 payload.source = 'daily_plan' 的发布 action（factory-reel 走另一条路径，
 *     没有 campaign_id，不参与 Daily Plan 的 Tune）。
 *   - 只读、无写入、无外部调用。RPC / provider / cron 都不动。
 *   - 不做跨客户比较：clientId + campaignId 是必填参数，不给默认。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  PostMeasurement,
  PostMeasurementStatus,
  PostMetricField,
} from './types'

const T72_WINDOW_HOURS = 72
const DEFAULT_COHORT_LIMIT = 20
const SOCIAL_PUBLISH_ACTION_TYPE = 'social.publish_post'
const DAILY_PLAN_SOURCE = 'daily_plan'
const PRIMARY_METRIC_FIELDS: readonly PostMetricField[] = ['likes', 'comments', 'shares']

export interface LoadCohortInput {
  clientId:       string
  campaignId:     string
  /** 要评估的这条 action 的 id（会被从 cohort 里剔除、单独放到 target 里）。 */
  targetActionId: string
  /**
   * 拉取上限（含 target）。默认 20 —— 内容工厂当前节奏下 20 条 ≈ 3 周历史，
   * 足以支撑最小样本 3 的判定，又不至于让均值被半年前的旧帖拖偏。
   */
  limit?:         number
}

export interface CohortResult {
  /** 找不到 target 的 T+72 receipt（例如尚未到点、或不可测）时为 null。 */
  target:      PostMeasurement | null
  /** 不含 target 自身。已按 executed_at 降序（新的在前）。 */
  cohort:      PostMeasurement[]
  /** 排查用：区分「一条历史都没有」和「有历史但都没 T+72 receipt」。 */
  diagnostics: {
    candidateActionCount: number
    withT72ReceiptCount:  number
  }
}

interface ActionRow {
  id:          string
  executed_at: string | null
}

interface ReceiptRow {
  action_id:    string
  window_hours: number
  status:       string
  values:       unknown
  missing:      unknown
}

export async function loadPostCohort(
  supabase: SupabaseClient,
  input: LoadCohortInput,
): Promise<CohortResult> {
  const limit = input.limit ?? DEFAULT_COHORT_LIMIT

  // Step 1: 候选 action。target 也会落在这批里 —— 后面按 id 分开。
  const { data: actionsData, error: actionsError } = await supabase
    .from('flywheel_actions')
    .select('id, executed_at')
    .eq('client_id',           input.clientId)
    .eq('action_type',         SOCIAL_PUBLISH_ACTION_TYPE)
    .eq('payload->>source',    DAILY_PLAN_SOURCE)
    .eq('payload->>campaign_id', input.campaignId)
    .order('executed_at', { ascending: false, nullsFirst: false })
    .limit(limit)

  if (actionsError) {
    throw new Error(`loadPostCohort: read flywheel_actions failed — ${actionsError.message}`)
  }

  const actionRows = (actionsData ?? []) as ActionRow[]
  if (actionRows.length === 0) {
    return {
      target: null,
      cohort: [],
      diagnostics: { candidateActionCount: 0, withT72ReceiptCount: 0 },
    }
  }

  // Step 2: 这批 action 的 T+72 回执。用 in() 一次拉完，比一条一 select 少得多。
  const actionIds = actionRows.map((r) => r.id)
  const { data: receiptsData, error: receiptsError } = await supabase
    .from('social_post_measurement_receipts')
    .select('action_id, window_hours, status, values, missing')
    .in('action_id', actionIds)
    .eq('window_hours', T72_WINDOW_HOURS)

  if (receiptsError) {
    throw new Error(
      `loadPostCohort: read social_post_measurement_receipts failed — ${receiptsError.message}`,
    )
  }

  const receiptRows = (receiptsData ?? []) as ReceiptRow[]

  // 按 action id 归位，保留 action 的 executed_at 排序。
  const byActionId = new Map<string, ReceiptRow>()
  for (const r of receiptRows) byActionId.set(r.action_id, r)

  const measurements: PostMeasurement[] = []
  for (const a of actionRows) {
    const r = byActionId.get(a.id)
    if (!r) continue
    measurements.push(toMeasurement(r))
  }

  const target = measurements.find((m) => m.actionId === input.targetActionId) ?? null
  const cohort = measurements.filter((m) => m.actionId !== input.targetActionId)

  return {
    target,
    cohort,
    diagnostics: {
      candidateActionCount: actionRows.length,
      withT72ReceiptCount:  receiptRows.length,
    },
  }
}

// ── 归一化：DB 行 → PostMeasurement ────────────────────────────────────────

function toMeasurement(row: ReceiptRow): PostMeasurement {
  return {
    actionId:    row.action_id,
    windowHours: row.window_hours,
    status:      normalizeStatus(row.status),
    values:      parseNumberMap(row.values),
    missing:     parseStringMap(row.missing),
  }
}

function normalizeStatus(raw: string): PostMeasurementStatus {
  // DB check constraint 保证只有 ok / partial / unmeasurable 三态；未知值一律
  // 降级为 unmeasurable，evaluator 会挡在 Gate 2 上，绝不当作可用样本参与均值。
  //
  // 但降级必须留声：将来 DB 若加了新 status（'timeout' / 'rate_limited'），
  // 静默降级会让整批 partial 数据无声消失，PM 只见「数据还不够说话」。
  if (raw === 'ok' || raw === 'partial' || raw === 'unmeasurable') return raw
  console.warn(`[social-post-cohort] unknown receipt status '${raw}' — downgrading to unmeasurable`)
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
