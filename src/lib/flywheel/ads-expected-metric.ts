/**
 * Which metric should an ads action be judged on?
 *
 * The old answer was "ROAS, always" (hard-coded in package-publish.ts and
 * zhuge/action-persister.ts). That is right for a shop and meaningless for
 * everyone else: 30 Kiteroa is a Messenger-objective property lead-gen
 * campaign, so Meta reports no purchase and no purchase_roas — the metric could
 * never arrive, and every action written against it was unattributable from the
 * moment it was created.
 *
 * So the metric follows the objective:
 *   sells something          → ROAS
 *   collects form leads      → cost per lead
 *   starts conversations     → cost per conversation
 *   anything else / unknown  → null, and say so in the log
 *
 * Never guess. A wrong metric is worse than no metric: no metric leaves the
 * action honestly unmeasured, a wrong one buries it as "skipped" forever.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { ADS_METRIC_KEY, type AdsMetricKey } from './vocabulary'
import { isAdsMetricPulled } from './metric-registry'

/** Campaign context available at the moment an action is written. */
export interface AdsObjectiveContext {
  /**
   * Platform campaign objective as reported by the platform.
   * Meta: `objective` (OUTCOME_SALES / OUTCOME_LEADS / …).
   * TikTok: `objective_type` (CONVERSIONS / LEAD_GENERATION / REACH / …).
   */
  objective?: string | null
  /**
   * Meta ad-set `destination_type` when known (WEBSITE / MESSENGER / WHATSAPP /
   * ON_AD). OUTCOME_LEADS covers both Instant Forms and click-to-Messenger, and
   * this is the only field that tells them apart.
   */
  destinationType?: string | null
}

export interface AdsExpectedMetricResolution {
  /** The metric to promise, or null when the objective does not imply one. */
  metricKey: AdsMetricKey | null
  /** Human-readable why — logged whenever metricKey is null. */
  reason: string
}

const SALES_OBJECTIVES = new Set([
  'OUTCOME_SALES', 'CONVERSIONS', 'PRODUCT_CATALOG_SALES', 'CATALOG_SALES',
])

const LEAD_OBJECTIVES = new Set([
  'OUTCOME_LEADS', 'LEAD_GENERATION',
])

const MESSAGE_OBJECTIVES = new Set([
  'MESSAGES', 'OUTCOME_ENGAGEMENT',
])

/** Ad-set destinations that mean "the outcome is a conversation, not a form". */
const MESSAGING_DESTINATIONS = new Set([
  'MESSENGER', 'WHATSAPP', 'INSTAGRAM_DIRECT', 'MESSAGING_APPS',
])

/**
 * Map a platform campaign objective to the metric its actions should be judged
 * on. Pure — no I/O, safe to call before touching the ad platform.
 */
export function resolveAdsExpectedMetric(
  ctx: AdsObjectiveContext,
): AdsExpectedMetricResolution {
  const objective = ctx.objective?.trim().toUpperCase() ?? ''
  const destination = ctx.destinationType?.trim().toUpperCase() ?? ''

  if (!objective) {
    return { metricKey: null, reason: 'no campaign objective available from the platform' }
  }

  // Destination wins over objective: OUTCOME_LEADS + MESSENGER is a
  // conversation campaign, and its leads arrive as conversations, not forms.
  if (destination && MESSAGING_DESTINATIONS.has(destination)) {
    return {
      metricKey: ADS_METRIC_KEY.COST_PER_CONVERSATION,
      reason: `destination ${destination} — outcome is a conversation`,
    }
  }

  if (SALES_OBJECTIVES.has(objective)) {
    return { metricKey: ADS_METRIC_KEY.ROAS, reason: `objective ${objective} — outcome is a purchase` }
  }
  if (MESSAGE_OBJECTIVES.has(objective)) {
    return {
      metricKey: ADS_METRIC_KEY.COST_PER_CONVERSATION,
      reason: `objective ${objective} — outcome is a conversation`,
    }
  }
  if (LEAD_OBJECTIVES.has(objective)) {
    return { metricKey: ADS_METRIC_KEY.COST_PER_LEAD, reason: `objective ${objective} — outcome is a form lead` }
  }

  return {
    metricKey: null,
    reason: `objective ${objective} has no outcome metric (awareness / traffic objectives are not attributable)`,
  }
}

// ── 「results = 0」是正常还是异常？ ────────────────────────────────────────────

/**
 * 这一段解决的是跟上面**不同的一个问题**。
 *
 * `resolveAdsExpectedMetric` 回答「该拿什么指标给这条动作打分」，触达/视频类目标
 * 一律返回 null —— 对打分来说这是对的。但读报表的人拿到的是另一个问题：
 * **这个广告系列花了 $432 却 0 个结果，是烧空了还是本来就该是 0？**
 *
 * 2026-08-04 真实误判：`OZ-THRU-S1-hooktest`（$432）、`CTS - ThruPlay Reels`（$233）、
 * `OZ-REACH-Warmpool`（$169）三条都是 0 结果，我一度当成「$834 打水漂」报给 PM。
 * 实际上它们的目标分别是看完视频和触达 —— **results 列对这类目标本来就恒为 0**，
 * 0 是对的，报警才是错的。
 *
 * 所以 `ad_daily_insights.results` 这一列**跨目标不可比**：
 *   Lead Form → 留资数 ／ 私信 → 对话数 ／ ThruPlay、触达 → 恒 0
 * 任何把它们放一起排序的代码都会得出荒谬结论。
 */

/** 触达 / 认知类目标：成效不是「结果数」，`results` 恒为 0。 */
const AWARENESS_OBJECTIVES = new Set([
  'OUTCOME_AWARENESS', 'REACH', 'BRAND_AWARENESS', 'AD_RECALL_LIFT',
])

/** 视频观看类目标：成效是播放/完播，`results` 同样不落在这一列。 */
const VIDEO_OBJECTIVES = new Set([
  'VIDEO_VIEWS', 'THRUPLAY', 'OUTCOME_VIDEO_VIEWS',
])

export interface ResultsColumnMeaning {
  /** `results` 这一列对该目标而言装的是什么。 */
  meaning: 'form_leads' | 'conversations' | 'purchases' | 'not_applicable' | 'unknown'
  /** results=0 是否属于正常预期 —— true 时不该报警、也不该参与「谁更便宜」的比较。 */
  zeroIsExpected: boolean
  /** 人话解释，直接可以打给 PM 看。 */
  reason: string
}

/**
 * `ad_daily_insights.results` 这一列，对这个目标来说装的是什么、0 正不正常。
 *
 * 纯函数。目标未知时返回 unknown 且 `zeroIsExpected=false` —— 宁可多问一句，
 * 也不要把真的烧空当成「本来就该是 0」放过去。
 */
export function describeResultsColumn(ctx: AdsObjectiveContext): ResultsColumnMeaning {
  const objective = ctx.objective?.trim().toUpperCase() ?? ''
  const destination = ctx.destinationType?.trim().toUpperCase() ?? ''

  if (!objective) {
    return {
      meaning: 'unknown',
      zeroIsExpected: false,
      reason: '拿不到广告目标 —— 无法判断 0 结果是正常还是烧空，需要人看一眼',
    }
  }

  // 跟 resolveAdsExpectedMetric 同一条规则：目的地优先于目标。
  if (destination && MESSAGING_DESTINATIONS.has(destination)) {
    return { meaning: 'conversations', zeroIsExpected: false, reason: `目的地 ${destination} —— results 是对话数，0 意味着没人开口` }
  }
  if (AWARENESS_OBJECTIVES.has(objective)) {
    return { meaning: 'not_applicable', zeroIsExpected: true, reason: `目标 ${objective} 是触达 —— results 恒为 0，该看的是触达人数和千次展示成本` }
  }
  if (VIDEO_OBJECTIVES.has(objective)) {
    return { meaning: 'not_applicable', zeroIsExpected: true, reason: `目标 ${objective} 是视频观看 —— results 恒为 0，该看的是完播次数和单次完播成本` }
  }
  if (SALES_OBJECTIVES.has(objective)) {
    return { meaning: 'purchases', zeroIsExpected: false, reason: `目标 ${objective} —— results 是成交数，0 意味着没卖出去` }
  }
  if (MESSAGE_OBJECTIVES.has(objective)) {
    return { meaning: 'conversations', zeroIsExpected: false, reason: `目标 ${objective} —— results 是对话数，0 意味着没人开口` }
  }
  if (LEAD_OBJECTIVES.has(objective)) {
    return { meaning: 'form_leads', zeroIsExpected: false, reason: `目标 ${objective} —— results 是留资数，0 意味着没人填表` }
  }

  return {
    meaning: 'unknown',
    zeroIsExpected: false,
    reason: `目标 ${objective} 不在已知分类里 —— 不假设 0 是正常的，需要人看一眼`,
  }
}

/**
 * 两个广告系列的 `results` 能不能直接比大小。
 *
 * 目标不同 → 不能。这就是「$834 误判」那件事的机器版本：把留资数和恒为 0 的
 * 触达放一起排序，排出来的名次没有任何意义。
 */
export function resultsAreComparable(a: AdsObjectiveContext, b: AdsObjectiveContext): boolean {
  const ma = describeResultsColumn(a)
  const mb = describeResultsColumn(b)
  if (ma.meaning === 'unknown' || mb.meaning === 'unknown') return false
  if (ma.meaning === 'not_applicable' || mb.meaning === 'not_applicable') return false
  return ma.meaning === mb.meaning
}

/**
 * Resolve and log in one step — the shape every action writer wants.
 *
 * A null result is logged rather than swallowed: "we wrote an action nobody can
 * grade" is precisely the event that went unnoticed for three months.
 */
export function resolveAndLogAdsExpectedMetric(
  ctx: AdsObjectiveContext,
  context: string,
): AdsMetricKey | null {
  const { metricKey, reason } = resolveAdsExpectedMetric(ctx)
  if (metricKey === null) {
    console.warn(`[${context}] no expected_metric for this ads action: ${reason}`)
  }
  return metricKey
}

// ── Client-level fallback ─────────────────────────────────────────────────────

/**
 * Outcome metrics in the order we would rather grade a client on.
 * Revenue beats cost-per-outcome; a purchase-driven account should be judged on
 * ROAS even if it also runs a lead form.
 */
const CLIENT_OUTCOME_PRIORITY: readonly AdsMetricKey[] = [
  ADS_METRIC_KEY.ROAS,
  ADS_METRIC_KEY.COST_PER_LEAD,
  ADS_METRIC_KEY.COST_PER_CONVERSATION,
  ADS_METRIC_KEY.CPA,
]

/** How far back a metric row still counts as "this client is measured on it". */
const LOOKBACK_DAYS = 90

/**
 * Pick an outcome metric for an ads action that has no campaign context —
 * a published production package, or a 诸葛亮 prescription at the client level.
 *
 * Answers from data rather than from a guess: whichever outcome metric this
 * client has actually accumulated rows for, highest priority first. A client
 * with no ads outcome data at all gets null — an unmeasured action recorded
 * honestly, instead of a ROAS promise that will never resolve.
 */
export async function resolveClientAdsExpectedMetric(
  supabase: Pick<SupabaseClient, 'from'>,
  clientId: string,
): Promise<AdsMetricKey | null> {
  const since = new Date()
  since.setDate(since.getDate() - LOOKBACK_DAYS)

  const { data, error } = await supabase
    .from('flywheel_metrics')
    .select('metric_key')
    .eq('client_id', clientId)
    .eq('flywheel', 'ads')
    .in('metric_key', CLIENT_OUTCOME_PRIORITY as string[])
    .gte('measured_at', since.toISOString())

  if (error) {
    console.warn(
      `[resolveClientAdsExpectedMetric] ${clientId}: metric lookup failed (${error.message}) — ` +
        'writing the action without an expected_metric rather than guessing one',
    )
    return null
  }

  const present = new Set((data ?? []).map(row => (row as { metric_key: string }).metric_key))
  const hit = CLIENT_OUTCOME_PRIORITY.find(key => present.has(key) && isAdsMetricPulled(key))

  if (!hit) {
    console.warn(
      `[resolveClientAdsExpectedMetric] ${clientId}: no ads outcome metric collected in the ` +
        `last ${LOOKBACK_DAYS} days — action recorded without an expected_metric`,
    )
    return null
  }
  return hit
}
