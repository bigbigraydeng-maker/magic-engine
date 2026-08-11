/**
 * Magic Engine 2.0 · GEO Measurement 契约 —— legacy 兼容映射器（Issue #876 / WP02）
 *
 * 🔴 **纯只读投影。** 不查库、不调用 provider、不回写、不补齐、不「修正」任何
 *    历史行。两个函数各自把一行已经取到手的 legacy 数据，映射成一份诚实的
 *    {@link GeoLegacyMappedObservation} —— 记录不到的维度一律显式「未知」，
 *    绝不填默认值、绝不用「当前值」冒充历史值（GEO 契约 §8.2 冻结）。
 *
 * 🔴 v1 冻结：legacy 映射仅限本文件报告过的两个纯投影，不做指标计算 ——
 *    citation 系列指标（citation / owned-domain / owned-page）在这份投影上
 *    恒为不可算，绝不是 0（Build Control Room 2026-08-10 WP02 实施授权裁定）。
 */

import type {
  AiTrackerLegacyRow,
  GeoAcquisitionIdentity,
  GeoInterpretationIdentity,
  GeoJsonValue,
  GeoLegacyMappedObservation,
  GeoMaybeUnknown,
  GeoSampleIdentity,
  IndustryAiVisibilityLegacyRow,
} from './types'

/** 🔴 每次都返回一份新的冻结值，防止调用方原地修改共享的「未知」结果。 */
function unrecorded<T>(): GeoMaybeUnknown<T> {
  return Object.freeze({ known: false as const, reason: 'not_recorded_by_source' as const })
}

const UNRECORDED_INTERPRETATION: GeoInterpretationIdentity = Object.freeze({
  parserVersion: unrecorded<string>(),
  metricRulesVersion: unrecorded<string>(),
})

const UNRECORDED_SAMPLE: GeoSampleIdentity = Object.freeze({
  samplePlan: unrecorded<{ readonly plannedCount: number }>(),
  sampleIndex: unrecorded<number>(),
  samplingParameters: unrecorded<{ readonly [key: string]: GeoJsonValue }>(),
})

/**
 * 客户级 AI Tracker（`src/lib/ai-tracker/**`）一行 → legacy 投影。
 *
 * 现状核对（GEO 契约 §8.1）：无 QuerySetVersion 概念、只有行 id（无稳定
 * query_key）、观测行上无 locale、market 只在问题层有、无 sample 三层任何一层、
 * 无 parser version、无 rules version、无 confidence 字段、不存引用来源。
 */
export function mapAiTrackerObservation(row: AiTrackerLegacyRow): GeoLegacyMappedObservation {
  const acquisition: GeoAcquisitionIdentity = {
    querySetVersion: unrecorded<string>(),
    // 只有行 id，没有稳定的语义键 —— 问题被原地改写就无声断链，不能冒充 query_key。
    queryKey: unrecorded<string>(),
    engineFamily: { known: true, value: row.aiEngine },
    // 模型名是自由文本、未受控词汇表 —— 可映射但标注降级。
    modelVersion: { known: true, value: row.aiModel },
    // 观测行上没有 locale。
    locale: unrecorded<string>(),
    // market 只在问题层有标签，观测行上没有 —— 标注「来自问题层，非观测层」。
    market: row.market,
    sample: UNRECORDED_SAMPLE,
  }

  return {
    sourceSystem: 'ai_tracker',
    sourceRowId: row.id,
    acquisition,
    interpretation: UNRECORDED_INTERPRETATION,
    // 客户级现状无 confidence 字段。
    confidence: unrecorded<number>(),
    comparableToNativeObservations: false,
    degradedDimensions: [
      'modelVersion: free-text, uncontrolled vocabulary',
      'market: sourced from the question layer, not the observation layer',
    ],
    citationMetricsComputable: false,
    citationNotComputableReason:
      'client-level AI Tracker observations do not store citation-source evidence; ' +
      'citation / owned-domain citation / direct owned-page citation cannot be backfilled from this row',
  }
}

/**
 * 行业级归档（`src/lib/industry-ai-visibility/**`）一行 → legacy 投影。
 *
 * 现状核对（GEO 契约 §8.1）：有 `question_hash`（可映射到 query_key）与
 * `locked_at`，但没有集合版本；语言/国家字段挂在问题层，非观测层；有
 * `parse_confidence`；有 `ai_citation_sources`，但仍无 parser version / rules
 * version，且本模块不建域名归属或页面台账子系统，无法据此判定
 * owned-domain / owned-page citation。
 */
export function mapIndustryAiVisibilityObservation(
  row: IndustryAiVisibilityLegacyRow,
): GeoLegacyMappedObservation {
  const acquisition: GeoAcquisitionIdentity = {
    // question_hash 有 locked_at 但没有「集合」版本概念 —— 不能冒充 QuerySetVersion。
    querySetVersion: unrecorded<string>(),
    queryKey: { known: true, value: row.questionHash },
    engineFamily: { known: true, value: row.platform },
    modelVersion: row.modelVersion,
    // 只能推断到问题层，不是观测层 —— 仍标降级。
    locale: row.locale,
    market: row.country,
    sample: UNRECORDED_SAMPLE,
  }

  const degradedDimensions: string[] = [
    'locale: sourced from the question layer, not the observation layer',
    'market: sourced from the question layer, not the observation layer',
  ]
  if (row.modelVersion.known) {
    degradedDimensions.push('modelVersion: free-text, uncontrolled vocabulary')
  }

  return {
    sourceSystem: 'industry_ai_visibility',
    sourceRowId: row.id,
    acquisition,
    interpretation: UNRECORDED_INTERPRETATION,
    confidence: row.parseConfidence,
    comparableToNativeObservations: false,
    degradedDimensions,
    citationMetricsComputable: false,
    citationNotComputableReason:
      'this mapper performs identity projection only, not metric computation; ' +
      'even where raw citation-source evidence exists on the row, owned-domain and owned-page ' +
      'citation require a verified owned-domain/alias set and a canonical page ledger that are ' +
      'out of WP02 scope, and parser/rules version is unrecorded on this source, so no citation-family ' +
      'metric can be honestly computed from this projection',
  }
}
