/**
 * Magic Engine 2.0 · GEO Measurement 契约 —— 可比性判定（Issue #876 / WP02）
 *
 * 🔴 **纯函数。** 不落库、不调用 provider、不做趋势判断。三条判据全部在
 *    GEO 契约 §6.1 冻结，本文件只是把文字判据翻成机器判定。
 *
 * 🔴 v1 冻结（Build Control Room 2026-08-10 WP02 实施授权裁定）：
 *    每条质量阈值**独立**施加于两侧队列，不平均、不许一侧补偿另一侧
 *    （对应 GEO 契约 §6.3 冻结第1条的精神）。质量阈值只裁决第3条，
 *    永远不放宽身份相等性，也永远不合并不匹配的队列。
 */

import {
  GEO_COMPARABILITY_POLICY_V1,
  type GeoAcquisitionIdentity,
  type GeoComparabilityCohortInput,
  type GeoComparabilityMismatch,
  type GeoComparabilityPolicy,
  type GeoComparabilityResult,
  type GeoInterpretationIdentity,
  type GeoMaybeUnknown,
} from './types'

function unwrapKnown<T>(v: GeoMaybeUnknown<T>): T | undefined {
  return v.known ? v.value : undefined
}

function sameKnownValue<T>(a: GeoMaybeUnknown<T>, b: GeoMaybeUnknown<T>): boolean {
  if (!a.known || !b.known) return false
  return a.value === b.value
}

/** 有限、非 NaN 的数值判据 —— 独立于「known/unknown」，判的是「known 里的值本身合不合法」。 */
function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

/** 有限且落在 [0,1] 的比率 —— confidence / engineCoverage / failureRate 共用的判据。 */
function isValidRatio(v: unknown): v is number {
  return isFiniteNumber(v) && v >= 0 && v <= 1
}

/**
 * 结构相等，`GeoJsonValue` 语义：对象比较忽略 key 插入顺序，数组比较保序。
 * 供 `sample.samplingParameters` 的可比性判定使用（sampling parameters 的
 * 序列化顺序不该造成假性不匹配）。
 */
function sameJsonStructure(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== typeof b) return false
  if (a === null || b === null) return a === b
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false
    if (a.length !== b.length) return false
    return a.every((v, i) => sameJsonStructure(v, b[i]))
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const aObj = a as Record<string, unknown>
    const bObj = b as Record<string, unknown>
    const aKeys = Object.keys(aObj).sort()
    const bKeys = Object.keys(bObj).sort()
    if (aKeys.length !== bKeys.length) return false
    return aKeys.every((k, i) => k === bKeys[i] && sameJsonStructure(aObj[k], bObj[k]))
  }
  return false
}

function checkAcquisitionIdentity(
  left: GeoAcquisitionIdentity,
  right: GeoAcquisitionIdentity,
): GeoComparabilityMismatch[] {
  const mismatches: GeoComparabilityMismatch[] = []

  const scalarDims: readonly (keyof Omit<GeoAcquisitionIdentity, 'sample'>)[] = [
    'querySetVersion',
    'queryKey',
    'engineFamily',
    'modelVersion',
    'locale',
    'market',
  ]
  for (const dim of scalarDims) {
    if (!sameKnownValue(left[dim], right[dim])) {
      mismatches.push({
        condition: 'acquisition_identity',
        dimension: dim,
        reason: `"${dim}" does not match or is unknown on at least one side`,
      })
    }
  }

  // 样本计划必须一致 —— 队列/批次层的「打算问几次」。
  const leftPlan = unwrapKnown(left.sample.samplePlan)
  const rightPlan = unwrapKnown(right.sample.samplePlan)
  if (!leftPlan || !rightPlan || leftPlan.plannedCount !== rightPlan.plannedCount) {
    mismatches.push({
      condition: 'acquisition_identity',
      dimension: 'sample.samplePlan',
      reason: 'sample plan differs or is unknown on at least one side',
    })
  }

  // 两侧都必须能重建样本序号身份，且身份必须相等 —— 缺一侧或不相等就不算
  // matched（GEO 契约 §3.2 冻结）。
  const leftIndex = left.sample.sampleIndex
  const rightIndex = right.sample.sampleIndex
  if (!leftIndex.known || !rightIndex.known) {
    mismatches.push({
      condition: 'acquisition_identity',
      dimension: 'sample.sampleIndex',
      reason: 'replicate identity cannot be reconstructed on at least one side',
    })
  } else if (leftIndex.value !== rightIndex.value) {
    mismatches.push({
      condition: 'acquisition_identity',
      dimension: 'sample.sampleIndex',
      reason: `replicate identity differs (${leftIndex.value} vs ${rightIndex.value})`,
    })
  }

  // 采样参数：一侧已知一侧未知视为不匹配；两侧都已知要结构相等（忽略 key 顺序）；
  // 两侧都未知是允许的 —— 契约只要求「可控且可得时才记」，都没记不代表不匹配。
  const leftParams = left.sample.samplingParameters
  const rightParams = right.sample.samplingParameters
  if (leftParams.known !== rightParams.known) {
    mismatches.push({
      condition: 'acquisition_identity',
      dimension: 'sample.samplingParameters',
      reason: 'sampling parameters are recorded on only one side',
    })
  } else if (leftParams.known && rightParams.known && !sameJsonStructure(leftParams.value, rightParams.value)) {
    mismatches.push({
      condition: 'acquisition_identity',
      dimension: 'sample.samplingParameters',
      reason: 'sampling parameters differ',
    })
  }

  return mismatches
}

function checkInterpretationIdentity(
  left: GeoInterpretationIdentity,
  right: GeoInterpretationIdentity,
): GeoComparabilityMismatch[] {
  const mismatches: GeoComparabilityMismatch[] = []

  // 冻结：两侧 parser 版本相同，或两侧都用同一个版本从不可变原始回答重新解析过 ——
  // 「重新解析」是编排层的动作，WP02 只能判定「声明的版本是否一致」，不能替编排层
  // 判定是否已重新解析；因此这里只接受「两侧已知且相同」为通过。
  if (!sameKnownValue(left.parserVersion, right.parserVersion)) {
    mismatches.push({
      condition: 'interpretation_identity',
      dimension: 'parserVersion',
      reason: 'parser version differs, is unknown, or neither side has been reparsed to a common version',
    })
  }

  if (!sameKnownValue(left.metricRulesVersion, right.metricRulesVersion)) {
    mismatches.push({
      condition: 'interpretation_identity',
      dimension: 'metricRulesVersion',
      reason: 'metric/taxonomy rules version differs or is unknown on at least one side',
    })
  }

  return mismatches
}

function checkQualitySide(
  side: 'left' | 'right',
  cohort: GeoComparabilityCohortInput,
  policy: GeoComparabilityPolicy,
): GeoComparabilityMismatch[] {
  const mismatches: GeoComparabilityMismatch[] = []

  const confidence = unwrapKnown(cohort.confidence)
  if (confidence === undefined || !isValidRatio(confidence)) {
    mismatches.push({
      condition: 'quality_thresholds',
      dimension: `${side}.confidence`,
      reason:
        confidence === undefined
          ? 'parser confidence is unknown'
          : `parser confidence ${confidence} is not a finite ratio in [0,1]`,
    })
  } else if (confidence < policy.minParserConfidence) {
    mismatches.push({
      condition: 'quality_thresholds',
      dimension: `${side}.confidence`,
      reason: `parser confidence ${confidence} is below the ${policy.minParserConfidence} floor`,
    })
  }

  const coverage = unwrapKnown(cohort.engineCoverage)
  if (coverage === undefined || !isValidRatio(coverage)) {
    mismatches.push({
      condition: 'quality_thresholds',
      dimension: `${side}.engineCoverage`,
      reason:
        coverage === undefined
          ? 'engine coverage is unknown'
          : `engine coverage ${coverage} is not a finite ratio in [0,1]`,
    })
  } else if (coverage < policy.minEngineCoverage) {
    mismatches.push({
      condition: 'quality_thresholds',
      dimension: `${side}.engineCoverage`,
      reason: `engine coverage ${coverage} is below the ${policy.minEngineCoverage} floor`,
    })
  }

  const failureRate = unwrapKnown(cohort.failureRate)
  if (failureRate === undefined || !isValidRatio(failureRate)) {
    mismatches.push({
      condition: 'quality_thresholds',
      dimension: `${side}.failureRate`,
      reason:
        failureRate === undefined
          ? 'failure rate is unknown'
          : `failure rate ${failureRate} is not a finite ratio in [0,1]`,
    })
  } else if (failureRate > policy.maxFailureRate) {
    mismatches.push({
      condition: 'quality_thresholds',
      dimension: `${side}.failureRate`,
      reason: `failure rate ${failureRate} exceeds the ${policy.maxFailureRate} ceiling`,
    })
  }

  return mismatches
}

/**
 * 三条判据全部成立才 `comparable: true`（GEO 契约 §6.1）。任何一条不成立，
 * 结果是 `not_comparable`，并带上是哪一条、哪一项不成立。
 *
 * 🔴 v1 冻结：质量阈值恒为 {@link GEO_COMPARABILITY_POLICY_V1}，独立施加于两侧，
 *    不平均、不许一侧补偿另一侧。**不接受调用方传入的运行时阈值** —— 否则任何
 *    调用方都能传一份全零阈值把不合格的队列判成 `comparable: true`，这条冻结
 *    政策就形同虚设。未来要换一版阈值，必须显式引入新的具名版本化策略，
 *    不能按次调用现改（Build Control Room 2026-08-10 WP02 复审裁定）。
 */
export function evaluateGeoComparability(
  left: GeoComparabilityCohortInput,
  right: GeoComparabilityCohortInput,
): GeoComparabilityResult {
  const policy = GEO_COMPARABILITY_POLICY_V1
  const mismatches: GeoComparabilityMismatch[] = [
    ...checkAcquisitionIdentity(left.acquisition, right.acquisition),
    ...checkInterpretationIdentity(left.interpretation, right.interpretation),
    ...checkQualitySide('left', left, policy),
    ...checkQualitySide('right', right, policy),
  ]

  return mismatches.length === 0 ? { comparable: true } : { comparable: false, mismatches }
}
