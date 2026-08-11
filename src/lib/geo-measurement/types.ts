/**
 * Magic Engine 2.0 · GEO Measurement 契约 —— 纯类型（Issue #876 / WP02）
 *
 * 🔴 **这个文件只描述形状，不做任何事。** 没有执行、没有落库、没有 provider 调用、
 *    没有 NLP / mention 分类逻辑、没有域名归属或页面台账子系统。
 *    契约冻结见 `docs/specs/2026-08-10-me2-geo-measurement-contract-v1.0.md`。
 *
 * 🔴 **与 `src/lib/growth/**` 平行，不扩展它。** 不 import growth 的任何符号 ——
 *    两份契约的「未知」原语各自独立冻结，同名不同事，混用会让下游以为二者可以
 *    互相赋值（架构测试盯着这条）。
 */

// ── 共用原语 ──────────────────────────────────────────────────────────────────

/** 「不知道」的理由码（GEO 契约 §3.4 第 3 条）。 */
export type GeoUnknownReason =
  /** 来源系统当时根本没记这一项。 */
  | 'not_recorded_by_source'
  /** 这一项对这条证据不适用。 */
  | 'not_applicable'
  /** 来源里有值但指向不唯一，认不准是哪一个。 */
  | 'source_ambiguous'

/**
 * 显式的「知道 / 不知道」。
 *
 * 🔴 刻意不用 `T | null`：省略会让下游把「不知道」读成「一样」，
 *    补 0 会读成「一次都没有」。字段缺失一律判非法输入。
 */
export type GeoMaybeUnknown<T> =
  | { readonly known: true; readonly value: T }
  | { readonly known: false; readonly reason: GeoUnknownReason }

/** JSON 安全的值。不含 `undefined`。 */
export type GeoJsonValue =
  | string
  | number
  | boolean
  | null
  | readonly GeoJsonValue[]
  | { readonly [key: string]: GeoJsonValue }

// ── §3.1 / §3.2 采集身份 ─────────────────────────────────────────────────────

/**
 * `sample` 必须拆成三件事（GEO 契约 §3.2）。
 *
 * 🔴 冻结：任一侧的样本计划不同，或任一侧无法重建样本序号身份，
 *    这次比较就不算 matched（由 `comparability.ts` 强制）。
 */
export interface GeoSampleIdentity {
  /** 样本计划 / 数量 —— 队列或批次层：这一轮打算问几次。 */
  readonly samplePlan: GeoMaybeUnknown<{ readonly plannedCount: number }>
  /** 样本序号 / 复本身份 —— 单条观测层：这一行是第几次。 */
  readonly sampleIndex: GeoMaybeUnknown<number>
  /** 影响输出的采样参数（温度 / 随机种子等）。可控且可得时才记，拿不到就是未知。 */
  readonly samplingParameters: GeoMaybeUnknown<{ readonly [key: string]: GeoJsonValue }>
}

/**
 * 一次观测的采集身份 = 七项的组合（GEO 契约 §3.1）。
 * 任何一项不同，就是另一次采集，不能直接对比。
 */
export interface GeoAcquisitionIdentity {
  readonly querySetVersion: GeoMaybeUnknown<string>
  readonly queryKey: GeoMaybeUnknown<string>
  readonly engineFamily: GeoMaybeUnknown<string>
  readonly modelVersion: GeoMaybeUnknown<string>
  readonly locale: GeoMaybeUnknown<string>
  readonly market: GeoMaybeUnknown<string>
  readonly sample: GeoSampleIdentity
}

// ── §3.3 解释身份 ─────────────────────────────────────────────────────────────

/**
 * 解释身份 —— 用哪一版逻辑把原始回答读成结构（GEO 契约 §3.3）。
 *
 * 🔴 v1 冻结：`metricRulesVersion` 是**单一不透明字符串**，不建每指标独立子版本
 *    基础设施（Build Control Room 2026-08-10 WP02 实施授权裁定）。
 */
export interface GeoInterpretationIdentity {
  readonly parserVersion: GeoMaybeUnknown<string>
  readonly metricRulesVersion: GeoMaybeUnknown<string>
}

// ── §4 不可变证据模型 ─────────────────────────────────────────────────────────

export interface GeoQuerySetQuery {
  readonly queryKey: string
  readonly questionText: string
  readonly locale: GeoMaybeUnknown<string>
  readonly market: GeoMaybeUnknown<string>
  readonly isActive: boolean
}

/** 版本化查询集。一旦被用于采集，问题文本永不可改（GEO 契约 §4.1）。 */
export interface GeoQuerySet {
  readonly querySetVersion: string
  /** 非空即锁死文本，仿 `question_hash` + `locked_at` 先例。 */
  readonly lockedAt: GeoMaybeUnknown<string>
  readonly queries: readonly GeoQuerySetQuery[]
}

export interface GeoCoverageDescriptor {
  readonly engines: readonly string[]
  readonly models: readonly string[]
  readonly locales: readonly string[]
  readonly markets: readonly string[]
  readonly queryKeys: readonly string[]
  readonly attempted: number
  readonly succeeded: number
  readonly failed: number
}

/** 一次采集执行。重跑创建新批次，绝不覆盖旧批次（GEO 契约 §4.2）。 */
export interface GeoBatch {
  readonly batchId: string
  readonly querySetVersion: string
  readonly startedAt: string
  readonly completedAt: GeoMaybeUnknown<string>
  /** 「部分完成」是一等结论，不许四舍五入成完成。 */
  readonly status: 'completed' | 'partial' | 'failed'
  readonly plannedCoverage: GeoCoverageDescriptor
  readonly actualCoverage: GeoCoverageDescriptor
  readonly costUsd: GeoMaybeUnknown<number>
  readonly triggeredBy: GeoMaybeUnknown<string>
}

/** 一条观测的成败结果。失败也是观测，必须显式落一条明确标为失败的行（GEO 契约 §4.3）。 */
export type GeoObservationOutcome =
  | { readonly ok: true; readonly evidenceId: string }
  | { readonly ok: false; readonly errorCode: string; readonly errorMessage: GeoMaybeUnknown<string> }

/**
 * 一个问题 × 一个引擎/模型 × 一次样本。不可变 —— 重跑产生新行，不更新旧行
 * （GEO 契约 §4.3）。
 */
export interface GeoObservation {
  readonly observationId: string
  readonly batchId: string
  readonly acquisition: GeoAcquisitionIdentity
  readonly interpretation: GeoInterpretationIdentity
  /** 解析置信度 0–1。**质量信号与阈值，不是身份维度**（GEO 契约 §3.3）。 */
  readonly confidence: GeoMaybeUnknown<number>
  readonly observedAt: string
  readonly outcome: GeoObservationOutcome
}

/**
 * 自有页面关联的判定结果。
 *
 * 🔴 v1 冻结：只保留显式字段，不建域名注册表或归属子系统
 *    （Build Control Room 2026-08-10 WP02 实施授权裁定）。
 */
export type GeoOwnedPageAssociation =
  | { readonly status: 'associated'; readonly pageRef: string }
  | { readonly status: 'not_associated' }
  /** 没有页面台账时的诚实结论 —— 绝不是 0（GEO 契约 §5 第3条冻结）。 */
  | { readonly status: 'not_computable'; readonly reason: string }

/** 一条引用来源。域名归属与页面关联分开记（GEO 契约 §4.4）。 */
export interface GeoCitation {
  readonly url: string
  readonly domain: string
  /** 是否属于客户经核实的自有域名 / 别名。未核实就是未知，不是 false。 */
  readonly ownedDomain: GeoMaybeUnknown<boolean>
  readonly ownedPage: GeoOwnedPageAssociation
}

/** 原始响应与引用来源，逐字保留供重新解析（GEO 契约 §4.4）。 */
export interface GeoEvidence {
  readonly evidenceId: string
  readonly observationId: string
  /** 原始形态在哪。定位不出来就显式记未知。 */
  readonly rawResponseLocator: GeoMaybeUnknown<string>
  readonly citations: readonly GeoCitation[]
}

// ── §5 七个指标 ───────────────────────────────────────────────────────────────

export type GeoMetricKey =
  | 'qualified_mention'
  | 'recommendation'
  | 'citation'
  | 'owned_domain_citation'
  | 'direct_owned_page_citation'
  | 'engine_coverage'

/**
 * 一个指标的值。`computable:false` 是诚实的「不可算」，绝不是 0
 * （GEO 契约 §5 第3条冻结）。
 */
export type GeoMetricValue =
  | { readonly computable: true; readonly value: number }
  | { readonly computable: false; readonly reason: string }

/**
 * 一个指标结果 —— 度量值 + 产出它时所用的解释身份（GEO 契约 §5 首段）。
 *
 * 🔴 v1 冻结：`qualified mention` 由「指标结果 + metricRulesVersion」表达，
 *    本模块不实现任何 NLP 解析 / mention 分类引擎 / 新判据启发式
 *    （Build Control Room 2026-08-10 WP02 实施授权裁定）。
 */
export interface GeoMetricResult {
  readonly metricKey: GeoMetricKey
  readonly value: GeoMetricValue
  readonly metricRulesVersion: GeoMaybeUnknown<string>
  /** 这个数是从多少次成功观测里算出来的。 */
  readonly sampleSize: number
}

/**
 * `conditional rank` 单独建模 —— **永远与 mention 分开报，永远不与
 * 「未提及」混算**（GEO 契约 §6.3 冻结第1条）。`applicable:false` 结构性地
 * 阻止「没提到」被当成「排名很靠后的一个数」。
 */
export type GeoConditionalRankValue =
  | { readonly applicable: true; readonly computable: true; readonly rank: number }
  | { readonly applicable: true; readonly computable: false; readonly reason: string }
  | { readonly applicable: false }

export interface GeoConditionalRankResult {
  readonly metricRulesVersion: GeoMaybeUnknown<string>
  readonly sampleSize: number
  readonly value: GeoConditionalRankValue
}

/** 七个指标的汇总（GEO 契约 §5）。 */
export interface GeoMetricsSummary {
  readonly qualifiedMention: GeoMetricResult
  readonly recommendation: GeoMetricResult
  readonly citation: GeoMetricResult
  readonly ownedDomainCitation: GeoMetricResult
  readonly directOwnedPageCitation: GeoMetricResult
  readonly conditionalRank: GeoConditionalRankResult
  readonly engineCoverage: GeoMetricResult
}

// ── §6 可比性（matched cohort）与 not_comparable ─────────────────────────────

export type GeoComparabilityConditionId =
  /** GEO 契约 §6.1 第1条：采集身份匹配。 */
  | 'acquisition_identity'
  /** GEO 契约 §6.1 第2条：解释身份一致。 */
  | 'interpretation_identity'
  /** GEO 契约 §6.1 第3条：质量阈值达标。 */
  | 'quality_thresholds'

/** 机器可读的不可比原因 —— 哪一条、哪一项不成立（GEO 契约 §6.1 末段）。 */
export interface GeoComparabilityMismatch {
  readonly condition: GeoComparabilityConditionId
  readonly dimension: string
  readonly reason: string
}

/**
 * `not_comparable` 是一等结论，不是错误（GEO 契约 §6.2）。
 */
export type GeoComparabilityResult =
  | { readonly comparable: true }
  | { readonly comparable: false; readonly mismatches: readonly GeoComparabilityMismatch[] }

/**
 * 可比性判据的质量阈值 —— 写死，不许每次运行时现算（GEO 契约 §6.1 第3条）。
 *
 * 🔴 v1 冻结值（Build Control Room 2026-08-10 WP02 实施授权裁定，回应契约 §10 M2）：
 *    parser 置信度下限 0.80 · 引擎覆盖率下限 0.80 · 失败率上限 0.20。
 */
export interface GeoComparabilityPolicy {
  readonly version: string
  readonly minParserConfidence: number
  readonly minEngineCoverage: number
  readonly maxFailureRate: number
}

export const GEO_COMPARABILITY_POLICY_V1: GeoComparabilityPolicy = Object.freeze({
  version: 'v1',
  minParserConfidence: 0.8,
  minEngineCoverage: 0.8,
  maxFailureRate: 0.2,
})

/** 参与可比性判定的一侧队列的最小输入。 */
export interface GeoComparabilityCohortInput {
  readonly acquisition: GeoAcquisitionIdentity
  readonly interpretation: GeoInterpretationIdentity
  readonly confidence: GeoMaybeUnknown<number>
  readonly engineCoverage: GeoMaybeUnknown<number>
  readonly failureRate: GeoMaybeUnknown<number>
}

// ── §8 对既有系统的保守映射 ───────────────────────────────────────────────────

/** `src/lib/ai-tracker/**` 客户级现状行的最小输入形状（本模块不读库，行由调用方取好传入）。 */
export interface AiTrackerLegacyRow {
  readonly id: string
  readonly aiEngine: string
  readonly aiModel: string
  readonly market: GeoMaybeUnknown<string>
  readonly rawResponse: GeoMaybeUnknown<string>
  readonly observedAt: string
  readonly errorMessage: GeoMaybeUnknown<string>
}

/** `src/lib/industry-ai-visibility/**` 行业级现状行的最小输入形状。 */
export interface IndustryAiVisibilityLegacyRow {
  readonly id: string
  readonly questionHash: string
  readonly platform: string
  readonly modelVersion: GeoMaybeUnknown<string>
  readonly locale: GeoMaybeUnknown<string>
  readonly country: GeoMaybeUnknown<string>
  readonly rawResponse: GeoMaybeUnknown<string>
  readonly parseConfidence: GeoMaybeUnknown<number>
  readonly citationSources: GeoMaybeUnknown<readonly string[]>
  readonly observedAt: string
  readonly errorMessage: GeoMaybeUnknown<string>
}

/**
 * legacy 映射的产物。相对 ME2 新观测**恒为** `not_comparable`
 * （GEO 契约 §8.2 规则1：采集侧与解释侧都缺，双重理由）。
 */
export interface GeoLegacyMappedObservation {
  readonly sourceSystem: 'ai_tracker' | 'industry_ai_visibility'
  readonly sourceRowId: string
  readonly acquisition: GeoAcquisitionIdentity
  readonly interpretation: GeoInterpretationIdentity
  readonly confidence: GeoMaybeUnknown<number>
  /** 冻结为字面量 `false` —— legacy 投影永远不可比。 */
  readonly comparableToNativeObservations: false
  /** 哪些维度被降级标注（如「来自问题层，非观测层」），供人工参考时不误读。 */
  readonly degradedDimensions: readonly string[]
  /** citation 系列指标（citation / owned-domain / owned-page）在此投影上恒不可算。 */
  readonly citationMetricsComputable: false
  readonly citationNotComputableReason: string
}
