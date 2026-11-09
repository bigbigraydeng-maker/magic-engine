/**
 * Magic Engine 2.0 · GEO 验证判定层（Issue #1347 · IMPACT 的 Check 段判定内核）
 *
 * 🔴 **本文件补的是「已冻结判据的执行侧」，不是新判据。** `verification.ts` 的
 *    `buildQualifiedMentionVerification` 早就在动作发生**之前**写下了三档判据
 *    （metricRef = `geo-module/m1/v1:qualified_mention_coverage`）；但全仓此前没有任何代码
 *    去执行它 —— 指标 key 在 `src/types/strategy.ts` 登记了一行，算它的代码不存在。
 *
 * 🔴 **判定内核就位 ≠ Check 段通电。** 本函数目前**零调用方**（只有 index.ts 的 re-export）：
 *    没有取数、没有事件、没有 receipt 落库。接线是后续 WP 的事，不要把它说成 IMPACT 闭环。
 *
 * 🔴 **纯函数、零副作用。** 不落库、不调 provider、不复测、不碰页面。
 *
 * 🔴 **「不误判 failure」的准确表述（三审证伪了原先的绝对说法）**：冻结判据要求
 *    not_comparable / 证据不足一律落 indeterminate。本层为此设四道闸，**并且不信任输入** ——
 *    闸 0 校验计数本身合法性。原先只校验分母不校验分子，魏征实测传
 *    `qualifiedMentionQueries: -5` 会直接落 `failure`；那条洞已由闸 0 堵上。
 *    准确表述：**闸 0-3 全过，才允许 failure**。
 *
 * 🔴 **必须比「比率」不比「绝对数」。** 两侧可解释 query 数常不同（defer 数量不同），
 *    13/18 → 9/12 绝对数在掉、比率在涨。比错了会把改进判成退步。
 *
 * 🔴 **但比率会被分母收缩骗（华佗实测）**：基线 13/18(72.2%) vs 复测 10/12(83.3%) 判 success，
 *    而被提及绝对数 13→10 其实在掉 —— 6 个 query 变 defer、分母缩了。极端版 17/18 数据丢失
 *    （复测只剩 1/1）也判 success。所以闸 3 除「分母 > 0」外，还要求复测侧可解释 query
 *    不得比基线缩水过多（阈值复用已冻结的 `GEO_COMPARABILITY_POLICY_V1.minEngineCoverage`，
 *    不新造数），并把两侧 queryCount / fullyDeferredQueries 一起报出来 —— 覆盖率永远配样本量读
 *    （照 `finding.ts` 既有先例）。
 *
 * 🔴 **整数交叉相乘的最终诚实说明（两轮变异验证后）**：本层用 `a*d vs c*b` 而非 `a/b vs c/d`。
 *    我先说它「防浮点陷阱」——错，换成浮点除法测试全绿。改口说「稳健性冗余」——**还是夸大**，
 *    魏征实测证伪了保留的两个理由：
 *      · 「query 量级暴涨时更稳」→ 反了。分母 ~1e8 时 `a*d` 乘积越过 2^53，**整数写法自己
 *        先失精度**，两种实现在同一量级同时失效，买不到一寸余量。
 *      · 「将来改加权计数时更稳」→ 反了。浮点权重（分母 17.9999999999）下交叉相乘会把
 *        1e-10 级舍入噪声放大成 `failure` —— 正是本文件承诺永不发生的误判。
 *    **最终结论**：两种写法在本层取值域内完全等价，选整数纯粹是**不引入除法、读起来直接**，
 *    不提供任何额外保护。将来若引入加权计数，**两种写法都必须换成带容差的比较**。
 */

import { evaluateGeoComparability, GEO_COMPARABILITY_POLICY_V1 } from '@/lib/geo-measurement'
import type { GeoComparabilityCohortInput, GeoComparabilityMismatch } from '@/lib/geo-measurement'
import { GEO_M1_RULE_VERSION } from './types'
import type { GeoCoverageSummary } from './types'

/** 判定结论三档 —— 与冻结判据 `criteria` 的三个键一一对应，不新增第四档。 */
export type GeoVerificationVerdict = 'success' | 'failure' | 'indeterminate'

/**
 * 机器可读原因码。**只用枚举不用自由文本** —— 审计要能按原因分组统计
 * （照 M1 `GeoM1ReasonCode` 的既有形态）。
 */
export type GeoVerificationReasonCode =
  /** 覆盖账计数不合法（非有限数 / 负数 / 非整数 / 分子 > 分母）。fail-closed。 */
  | 'malformed_coverage_input'
  /** 两侧解释身份（规则版本）对不上 —— 不同尺子量出来的数不能比。 */
  | 'rule_version_mismatch'
  /** 两侧观测 cohort 配不上对（数量不等 / 任一侧为空）。 */
  | 'cohort_pairing_failed'
  /** 测量层 `evaluateGeoComparability` 判不可比。 */
  | 'not_comparable'
  /** 基线侧可解释 query 为 0 —— 没有分母，算不出覆盖率。 */
  | 'insufficient_baseline_evidence'
  /** 复测侧可解释 query 为 0 —— 同上。 */
  | 'insufficient_followup_evidence'
  /** 复测侧可解释 query 相对基线缩水过多 —— 比率会被分母缩水骗高，不许判定。 */
  | 'denominator_shrunk'
  /** 合格提及覆盖率相对基线上升。 */
  | 'mention_coverage_increased'
  /** 合格提及覆盖率相对基线下降。 */
  | 'mention_coverage_decreased'
  /** 合格提及覆盖率与基线持平 —— 既不算成功也不算失败。 */
  | 'mention_coverage_unchanged'
  /** explicit_positive 覆盖率下降 —— 判据要求它「不下降」才允许 success。 */
  | 'explicit_positive_decreased'
  /** explicit_positive 覆盖率未下降 —— success 的第二个合取项已查验通过。 */
  | 'explicit_positive_not_decreased'

/**
 * 一侧的输入：已算好的覆盖账 + **该批次全部成功观测的 cohort 身份**。
 *
 * 🔴 `cohorts` 是数组不是单个 —— 平台唯一生产者 `buildComparabilityInputs`
 *    （`geo-measurement-runtime/summary.ts:110`）产的就是「每条成功观测一份」，批次上存的也是
 *    `comparabilityInputs: readonly GeoComparabilityCohortInput[]`。收单个会逼调用方要么随便挑
 *    一条当整批代表（假 comparable），要么手搓批次级 cohort 把 queryKey / sampleIndex 填成假值
 *    （伪造测量身份）—— 两条都架空判定的合法性基础（子牙 + 华佗独立指出）。
 */
export interface GeoVerificationSide {
  readonly coverage: GeoCoverageSummary
  readonly cohorts: readonly GeoComparabilityCohortInput[]
}

export interface GeoVerificationInput {
  readonly baseline: GeoVerificationSide
  readonly followUp: GeoVerificationSide
}

/** 一个比率的可读呈现。`known:false` 时带上为什么算不出，绝不补 0。 */
export type GeoRate =
  | { readonly known: true; readonly numerator: number; readonly denominator: number }
  | { readonly known: false; readonly reason: 'no_interpretable_queries' | 'malformed_counts' }

/** 一侧的样本量账 —— 覆盖率永远配样本量一起读（照 finding.ts 先例）。 */
export interface GeoVerificationSampleAccount {
  readonly queryCount: number
  readonly interpretableQueries: number
  readonly fullyDeferredQueries: number
}

export interface GeoVerificationOutcome {
  readonly verdict: GeoVerificationVerdict
  readonly reasonCodes: readonly GeoVerificationReasonCode[]
  /** 与 finding / verification 定义同一把尺子，便于回溯是哪个指标下的判定。 */
  readonly metricRef: string
  /** 两侧原始比率，供人工复核；不藏计算过程。 */
  readonly measured: {
    readonly baselineMention: GeoRate
    readonly followUpMention: GeoRate
    readonly baselineExplicitPositive: GeoRate
    readonly followUpExplicitPositive: GeoRate
  }
  /** 两侧样本量账 —— 没有它就看不出「分母是不是缩了」。 */
  readonly sample: {
    readonly baseline: GeoVerificationSampleAccount
    readonly followUp: GeoVerificationSampleAccount
  }
  /**
   * 不可比时透传测量层给出的具体不匹配项。
   * 🔴 `dimension` 里的 `left` = **baseline**，`right` = **followUp**（对应
   *    `evaluateGeoComparability(baselineCohort, followUpCohort)` 的传参顺序，有测试锁住）。
   */
  readonly comparabilityMismatches?: readonly GeoComparabilityMismatch[]
}

/** 计数必须是有限非负整数。NaN / Infinity / 小数 / 负数一律不合法。 */
function isValidCount(n: number): boolean {
  return Number.isInteger(n) && n >= 0
}

/**
 * 一侧覆盖账的合法性。
 * 🔴 **分子也要校验**，不能只校验分母 —— 魏征实测负数分子会直接落 `failure`。
 */
function isCoverageWellFormed(c: GeoCoverageSummary): boolean {
  const counts = [
    c.queryCount,
    c.interpretableQueries,
    c.qualifiedMentionQueries,
    c.explicitPositiveQueries,
  ]
  if (!counts.every(isValidCount)) return false
  // 结构不变量：分子不得超过分母；可解释数不得超过总数。
  if (c.qualifiedMentionQueries > c.interpretableQueries) return false
  if (c.explicitPositiveQueries > c.interpretableQueries) return false
  if (c.interpretableQueries > c.queryCount) return false
  return true
}

function rateOf(numerator: number, denominator: number): GeoRate {
  if (!isValidCount(numerator) || !isValidCount(denominator)) {
    return { known: false, reason: 'malformed_counts' }
  }
  return denominator > 0
    ? { known: true, numerator, denominator }
    : { known: false, reason: 'no_interpretable_queries' }
}

/**
 * 比较两个比率。返回 1 = right 比 left 高；-1 = 低；0 = 持平。
 * 调用方保证四个数都是合法计数且两个分母 > 0（闸 0 / 闸 3 已挡住）。
 * 🔴 整数写法与浮点除法在本层取值域内等价，不提供额外保护 —— 见文件头最终说明。
 */
function compareRates(
  leftNum: number,
  leftDen: number,
  rightNum: number,
  rightDen: number,
): -1 | 0 | 1 {
  // leftNum/leftDen vs rightNum/rightDen ⇔ leftNum*rightDen vs rightNum*leftDen（分母都 > 0）
  const l = leftNum * rightDen
  const r = rightNum * leftDen
  if (r > l) return 1
  if (r < l) return -1
  return 0
}

function sampleAccountOf(c: GeoCoverageSummary): GeoVerificationSampleAccount {
  return {
    queryCount: c.queryCount,
    interpretableQueries: c.interpretableQueries,
    fullyDeferredQueries: c.fullyDeferredQueries,
  }
}

function measuredOf(input: GeoVerificationInput): GeoVerificationOutcome['measured'] {
  const b = input.baseline.coverage
  const f = input.followUp.coverage
  return {
    baselineMention: rateOf(b.qualifiedMentionQueries, b.interpretableQueries),
    followUpMention: rateOf(f.qualifiedMentionQueries, f.interpretableQueries),
    baselineExplicitPositive: rateOf(b.explicitPositiveQueries, b.interpretableQueries),
    followUpExplicitPositive: rateOf(f.explicitPositiveQueries, f.interpretableQueries),
  }
}

type PairingResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'cohort_pairing_failed' }
  | {
      readonly ok: false
      readonly reason: 'not_comparable'
      readonly mismatches: readonly GeoComparabilityMismatch[]
    }

/** 观测身份键 = (queryKey, sampleIndex)。任一未知 → 该条无法配对。 */
function pairKeyOf(c: GeoComparabilityCohortInput): string | null {
  const qk = c.acquisition.queryKey
  const si = c.acquisition.sample.sampleIndex
  if (!qk.known || !si.known) return null
  return `${qk.value}#${si.value}`
}

/**
 * 两侧 cohort **按 (queryKey, sampleIndex) 配对**判可比。
 *
 * 🔴 **不能按数组下标配对，也不能要求两侧数量相等。** `buildComparabilityInputs` 只收录
 *    **成功观测**（`summary.ts:114` 的 `filter(o => o.outcome.ok)`），两批的失败/defer 条数
 *    本来就不同 —— 要求数量相等会把所有真实的复测都判成 pairing_failed。
 *
 * 🔴 **只比两侧都有的那些观测。** 一侧独有的 query 说明它在另一侧没成功采到，那是覆盖账
 *    （闸 3 的分母收缩）该管的事，不是可比性该管的事。
 *
 * 🔴 `queryKey` / `sampleIndex` 是批次内**唯一会变**的维度，它们本身对「两批能不能比」没有
 *    意义 —— 真正的判据是采集身份（引擎/模型/locale/查询集）、解释身份（parser/rules）与
 *    质量三项。用它们做配对键，正好让 `evaluateGeoComparability` 去比那些真正该比的维度。
 *
 * 🔴 任一配对不可比 → 整批不可比。**不许一侧补偿另一侧**（与 WP02 v1 冻结的
 *    「质量阈值独立施加于两侧、不平均」同一精神）。
 * 🔴 传参顺序固定 `(baseline, followUp)` —— mismatch 里的 `left` 恒指 baseline，有测试锁住。
 */
function pairwiseComparability(
  baseline: readonly GeoComparabilityCohortInput[],
  followUp: readonly GeoComparabilityCohortInput[],
): PairingResult {
  if (baseline.length === 0 || followUp.length === 0) {
    return { ok: false, reason: 'cohort_pairing_failed' }
  }
  const followUpByKey = new Map<string, GeoComparabilityCohortInput>()
  for (const c of followUp) {
    const k = pairKeyOf(c)
    if (k !== null) followUpByKey.set(k, c)
  }
  let paired = 0
  for (const b of baseline) {
    const k = pairKeyOf(b)
    if (k === null) continue
    const f = followUpByKey.get(k)
    if (f === undefined) continue
    paired++
    const r = evaluateGeoComparability(b, f)
    if (!r.comparable) return { ok: false, reason: 'not_comparable', mismatches: r.mismatches }
  }
  // 一条都配不上 = 两批根本不是同一组问题（或身份全未知），不能比。
  if (paired === 0) return { ok: false, reason: 'cohort_pairing_failed' }
  return { ok: true }
}

/**
 * 执行冻结的合格提及覆盖判据，给出三档结论。
 *
 * 判定顺序（**fail-closed**，任一道闸不过直接落 indeterminate，绝不继续往下算）：
 *   0. 两侧计数合法吗？（有限非负整数、分子 ≤ 分母 ≤ 总数）
 *   1. 两侧规则版本相同吗？
 *   2. 两侧 cohort 逐对可比吗？
 *   3. 两侧都有可解释 query，且复测侧分母没有缩水过多？
 *   4. 比合格提及覆盖率：下降 → failure；上升 → 还要 explicit_positive 不下降才 success
 *
 * 🔴 **两条「非上升非明确下降」的收敛（魏征复核后的准确归因）**：以下两种情形落
 *    `indeterminate`，**是冻结判据文本的直接推论、不是本层自作主张**：
 *      · **提及覆盖持平** —— 不满足 success（要求「上升」），也不满足 failure（要求「明确下降」）
 *      · **提及上升但 explicit_positive 下降** —— success 两个合取项缺一；failure 的前提
 *        （提及下降）不成立
 *    三档是封闭集合，这两种情形除 indeterminate 无处可去。
 *
 * ⚠️ **已知产品级风险（非本层缺陷，已升级 PO）**：EP 分母只有 ~18，掉 1 个 query = 5.6pp。
 *    按 CTS 真实基线二项推演，**即使行动真的把提及做上去了，仍有约 40% 概率因 EP 的单 query
 *    抖动被判 indeterminate**。根源是冻结判据把 success 定成合取、且样本量太小。
 *
 * ⚠️ **样本量显著性闸尚未实装**：n=18 时 13/18 → 12/18（差 1 个 query，McNemar p=1.000 纯噪声）
 *    当前会判 `failure`。加不加最小变化闸、闸设多严，是 PO 的风险偏好决定，**不由本层自行发明**。
 */
export function evaluateQualifiedMentionVerdict(
  input: GeoVerificationInput,
): GeoVerificationOutcome {
  const metricRef = `${GEO_M1_RULE_VERSION}:qualified_mention_coverage`
  const b = input.baseline.coverage
  const f = input.followUp.coverage
  const measured = measuredOf(input)
  const sample = { baseline: sampleAccountOf(b), followUp: sampleAccountOf(f) }
  const base = { metricRef, measured, sample } as const

  // ── 闸 0：不信任输入。计数必须合法，分子也要查（不能只查分母）──
  if (!isCoverageWellFormed(b) || !isCoverageWellFormed(f)) {
    return { verdict: 'indeterminate', reasonCodes: ['malformed_coverage_input'], ...base }
  }

  // ── 闸 1：解释身份（规则版本）必须一致 ──
  if (b.ruleVersion !== f.ruleVersion) {
    return { verdict: 'indeterminate', reasonCodes: ['rule_version_mismatch'], ...base }
  }

  // ── 闸 2：两侧 cohort 逐对可比 ──
  const pairing = pairwiseComparability(input.baseline.cohorts, input.followUp.cohorts)
  if (!pairing.ok) {
    return pairing.reason === 'not_comparable'
      ? {
          verdict: 'indeterminate',
          reasonCodes: ['not_comparable'],
          ...base,
          comparabilityMismatches: pairing.mismatches,
        }
      : { verdict: 'indeterminate', reasonCodes: ['cohort_pairing_failed'], ...base }
  }

  // ── 闸 3：两侧都要有分母，且复测侧分母不得缩水过多 ──
  const evidenceGaps: GeoVerificationReasonCode[] = []
  if (b.interpretableQueries <= 0) evidenceGaps.push('insufficient_baseline_evidence')
  if (f.interpretableQueries <= 0) evidenceGaps.push('insufficient_followup_evidence')
  if (evidenceGaps.length > 0) {
    return { verdict: 'indeterminate', reasonCodes: evidenceGaps, ...base }
  }
  // 复用已冻结的 minEngineCoverage 当收缩下限，不新造阈值（华佗建议）。
  if (f.interpretableQueries < b.interpretableQueries * GEO_COMPARABILITY_POLICY_V1.minEngineCoverage) {
    return { verdict: 'indeterminate', reasonCodes: ['denominator_shrunk'], ...base }
  }

  // ── 闸 4：比覆盖率 ──
  const mentionDelta = compareRates(
    b.qualifiedMentionQueries,
    b.interpretableQueries,
    f.qualifiedMentionQueries,
    f.interpretableQueries,
  )
  const explicitPositiveDelta = compareRates(
    b.explicitPositiveQueries,
    b.interpretableQueries,
    f.explicitPositiveQueries,
    f.interpretableQueries,
  )
  const epCode: GeoVerificationReasonCode =
    explicitPositiveDelta < 0 ? 'explicit_positive_decreased' : 'explicit_positive_not_decreased'

  if (mentionDelta < 0) {
    // 提及覆盖明确下降，且闸 0-3 全过 → 判据原文的 failure。
    // 🔴 EP 方向一并记入凭据：审计要能看到 failure 时 EP 是什么情况（魏征 A1）。
    return { verdict: 'failure', reasonCodes: ['mention_coverage_decreased', epCode], ...base }
  }

  if (mentionDelta === 0) {
    return { verdict: 'indeterminate', reasonCodes: ['mention_coverage_unchanged', epCode], ...base }
  }

  // mentionDelta > 0：提及覆盖上升。success 还要求 explicit_positive 不下降。
  if (explicitPositiveDelta < 0) {
    return {
      verdict: 'indeterminate',
      reasonCodes: ['mention_coverage_increased', 'explicit_positive_decreased'],
      ...base,
    }
  }

  // 🔴 success 的凭据必须证明**两个**合取项都查过（魏征 A1）。
  return {
    verdict: 'success',
    reasonCodes: ['mention_coverage_increased', 'explicit_positive_not_decreased'],
    ...base,
  }
}
