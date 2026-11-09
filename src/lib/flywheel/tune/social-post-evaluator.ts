/**
 * Social Tune v1 — evaluator（Gate B 步骤 1，纯函数）。
 *
 * 输入：target（要评估的一条 T+72 测量）+ cohort（同客户 + 同活动 + 同窗口的历史）。
 * 输出：REPEAT / ITERATE / STOP / INCONCLUSIVE + 依据 + 可比样本量 + caveats + lineage。
 *
 * 硬边界（Issue #1413）：
 *   - 只处理 Facebook Daily Plan Post。
 *   - 不做跨客户 / 跨支柱 benchmark：cohort 的过滤（同 client、同 campaign、同窗口）
 *     是**调用方**的责任 —— evaluator 不知道客户 / campaign 是谁，也不该知道。
 *   - 缺 T+72、可比样本 < 阈值、target 不可测、无共同主指标 → INCONCLUSIVE，绝不猜。
 *   - shares 缺失是已知能力边界（token 无 read_insights），进 caveats，不影响主指标判断。
 *   - 无 I/O。无 client / 行业硬编码。
 *
 * 阈值来源：默认见 DEFAULT_THRESHOLDS。Playbook / Profile / Configuration 未来可覆盖。
 */

import type {
  PostEvaluationInput,
  PostMeasurement,
  PostMetricField,
  TuneRecommendation,
  TuneThresholds,
} from './types'

/** PM 2026-09-07 拍板的初始阈值。 */
export const DEFAULT_THRESHOLDS: TuneThresholds = {
  minSampleSize:  3,
  repeatDeltaPct: 30,
  stopDeltaPct:   -30,
}

/** target 必须是 T+72 才有评估价值（T+4 太早，不代表帖子最终表现）。 */
const REQUIRED_WINDOW_HOURS = 72

/**
 * 主指标优先级：likes 最容易采到 → comments 次之。
 * shares 单独处理（缺失是常态，只进 caveats，不参与主指标选择）。
 */
const PRIMARY_METRIC_PRIORITY: PostMetricField[] = ['likes', 'comments']

export function evaluateSocialPost(input: PostEvaluationInput): TuneRecommendation {
  const thresholds: TuneThresholds = { ...DEFAULT_THRESHOLDS, ...(input.thresholds ?? {}) }
  const { target, cohort } = input
  const baseCaveats: string[] = []

  // Gate 1：target 必须是 T+72。T+4 不足以判 REPEAT / STOP。
  if (target.windowHours !== REQUIRED_WINDOW_HOURS) {
    return inconclusive({
      reason: 'missing_t72',
      rationale: `建议只在 T+72 窗口上做，当前 target 是 T+${target.windowHours}。`,
      target,
      sampleSize: 0,
      caveats: baseCaveats,
      thresholds,
    })
  }

  // Gate 2：target 本身不可测（无回执 / graph 报错 / 权限全无），直接说不了。
  if (target.status === 'unmeasurable') {
    return inconclusive({
      reason: 'unmeasurable_target',
      rationale: '这条帖子本身没能采到成绩（回执标为不可测），无法与历史比较。',
      target,
      sampleSize: 0,
      caveats: baseCaveats,
      thresholds,
    })
  }

  // Gate 3：cohort 里过滤出「窗口对得上、且不是 unmeasurable」的样本。
  //         调用方已经按 client + campaign 圈过，这里只做窗口 + 可测性过滤。
  const eligibleCohort = cohort.filter(
    (m) => m.windowHours === REQUIRED_WINDOW_HOURS && m.status !== 'unmeasurable',
  )

  // Gate 4：选主指标 —— target 和至少 minSampleSize 条 eligibleCohort 都有该指标数字。
  const chosen = pickPrimaryMetric(target, eligibleCohort, thresholds.minSampleSize)

  if (!chosen) {
    // 分辨两种不同的「说不了」：是根本没共同指标，还是共同指标下样本不够。
    const anyOverlap = PRIMARY_METRIC_PRIORITY.some(
      (m) => hasValue(target, m) && eligibleCohort.some((c) => hasValue(c, m)),
    )
    const caveats = collectCaveats(target, eligibleCohort, null, baseCaveats)
    if (!anyOverlap) {
      return inconclusive({
        reason: 'no_comparable_metric',
        rationale: '这条帖子与历史帖子没有共同的可比指标（likes / comments 都对不上）。',
        target,
        sampleSize: 0,
        caveats,
        thresholds,
      })
    }
    // 有共同指标但可比样本不够。
    const usableCount = countUsable(eligibleCohort, PRIMARY_METRIC_PRIORITY)
    return inconclusive({
      reason: 'insufficient_cohort',
      rationale: `可比历史帖子只有 ${usableCount} 条，少于最低要求 ${thresholds.minSampleSize} 条，数据还不够说话。`,
      target,
      sampleSize: usableCount,
      caveats,
      thresholds,
    })
  }

  // 主指标定了 → 算 delta，落决策。
  const targetValue = target.values[chosen.metric] as number
  const cohortValues = chosen.cohortSamples.map((c) => c.values[chosen.metric] as number)
  const cohortMean = mean(cohortValues)

  // cohort 均值为 0（全 0 的历史）时 delta 无意义 —— 用绝对差判：target > 0 视为改善。
  const deltaPct = cohortMean === 0
    ? (targetValue === 0 ? 0 : Number.POSITIVE_INFINITY)
    : ((targetValue - cohortMean) / cohortMean) * 100

  const decision =
    deltaPct >= thresholds.repeatDeltaPct ? 'REPEAT' :
    deltaPct <= thresholds.stopDeltaPct   ? 'STOP'   :
    'ITERATE'

  const rationale = buildRationale(decision, chosen.metric, targetValue, cohortMean, deltaPct, chosen.cohortSamples.length)
  const caveats = collectCaveats(target, eligibleCohort, chosen.metric, baseCaveats)

  return {
    decision,
    rationale,
    primaryMetric:  chosen.metric,
    targetValue,
    cohortMean,
    deltaPct: Number.isFinite(deltaPct) ? roundTo(deltaPct, 1) : deltaPct,
    sampleSize:     chosen.cohortSamples.length,
    caveats,
    sourceActionIds: [target.actionId, ...chosen.cohortSamples.map((c) => c.actionId)],
    thresholdsUsed: thresholds,
  }
}

// ── 内部工具 ──────────────────────────────────────────────────────────────

function hasValue(m: PostMeasurement, metric: PostMetricField): boolean {
  const v = m.values[metric]
  return typeof v === 'number' && Number.isFinite(v)
}

function pickPrimaryMetric(
  target: PostMeasurement,
  eligibleCohort: PostMeasurement[],
  minSampleSize: number,
): { metric: PostMetricField; cohortSamples: PostMeasurement[] } | null {
  for (const metric of PRIMARY_METRIC_PRIORITY) {
    if (!hasValue(target, metric)) continue
    const cohortSamples = eligibleCohort.filter((c) => hasValue(c, metric))
    if (cohortSamples.length >= minSampleSize) {
      return { metric, cohortSamples }
    }
  }
  return null
}

function countUsable(cohort: PostMeasurement[], metrics: PostMetricField[]): number {
  // 每条 cohort 只要有任一 metric 就算「可用」—— 用来告诉 PM 手里有多少条可比。
  return cohort.filter((c) => metrics.some((m) => hasValue(c, m))).length
}

function collectCaveats(
  target: PostMeasurement,
  eligibleCohort: PostMeasurement[],
  chosenMetric: PostMetricField | null,
  base: string[],
): string[] {
  const caveats = [...base]

  if (target.status === 'partial') caveats.push('target_partial')
  if (target.missing.shares || !hasValue(target, 'shares')) {
    caveats.push('shares_missing_on_target')
  }

  const cohortMissingShares = eligibleCohort.length > 0 &&
    eligibleCohort.every((c) => !hasValue(c, 'shares'))
  if (cohortMissingShares) caveats.push('shares_missing_across_cohort')

  if (chosenMetric === 'comments' && hasValue(target, 'likes')) {
    // 说明有 likes 但样本不够，回退到 comments —— 让 PM 知道有指标降级。
    caveats.push('fell_back_from_likes_to_comments')
  }

  return caveats
}

function mean(xs: number[]): number {
  if (xs.length === 0) return 0
  return xs.reduce((a, b) => a + b, 0) / xs.length
}

function roundTo(x: number, digits: number): number {
  const p = 10 ** digits
  return Math.round(x * p) / p
}

function buildRationale(
  decision: 'REPEAT' | 'ITERATE' | 'STOP',
  metric: PostMetricField,
  targetValue: number,
  cohortMean: number,
  deltaPct: number,
  sampleSize: number,
): string {
  const deltaText = Number.isFinite(deltaPct)
    ? `${deltaPct >= 0 ? '+' : ''}${roundTo(deltaPct, 1)}%`
    : '大幅上升（历史均值为 0）'
  const meanText = roundTo(cohortMean, 2)
  const head =
    decision === 'REPEAT'  ? '这条明显比同类历史好，值得再做一次。' :
    decision === 'STOP'    ? '这条明显比同类历史差，不建议再走这个路数。' :
    '效果跟同类历史差不多，可以微调（文案 / 时段）再试。'
  return `${head}（${metric}：本条 ${targetValue}，历史 ${sampleSize} 条均值 ${meanText}，差 ${deltaText}）`
}

function inconclusive(args: {
  reason: 'missing_t72' | 'unmeasurable_target' | 'no_comparable_metric' | 'insufficient_cohort'
  rationale: string
  target: PostMeasurement
  sampleSize: number
  caveats: string[]
  thresholds: TuneThresholds
}): TuneRecommendation {
  return {
    decision: 'INCONCLUSIVE',
    rationale: args.rationale,
    inconclusiveReason: args.reason,
    primaryMetric:  null,
    targetValue:    null,
    cohortMean:     null,
    deltaPct:       null,
    sampleSize:     args.sampleSize,
    caveats:        args.caveats,
    sourceActionIds:[args.target.actionId],
    thresholdsUsed: args.thresholds,
  }
}
