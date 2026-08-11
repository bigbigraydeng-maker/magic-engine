/**
 * Magic Engine 2.0 · GEO Measurement 契约 —— 纯校验器（Issue #876 / WP02）
 *
 * 🔴 **纯函数。** 不落库、不改传入对象、不规范化、不推断、不补默认值、
 *    不做任何指标计算或 mention 分类。同样的输入必然得到同样的结论。
 *
 * 返回形状沿用 `src/lib/growth/validators.ts` 的惯例：
 * `{ ok: true } | { ok: false; reason }`。不引第三方校验器，不 import growth。
 */

import type { GeoAcquisitionIdentity, GeoMetricsSummary } from './types'

export type GeoValidationResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string }

/** 🔴 全模块共用同一个成功值，冻结防止调用方改到别人的结果。 */
const OK: GeoValidationResult = Object.freeze({ ok: true as const })
const fail = (reason: string): GeoValidationResult => Object.freeze({ ok: false as const, reason })

// ── 基础判据 ──────────────────────────────────────────────────────────────────

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isParseableTimestamp(value: unknown): boolean {
  return isNonEmptyString(value) && !Number.isNaN(Date.parse(value))
}

/** 校验 `GeoMaybeUnknown<T>` 判别式联合的形状本身，不校验 `value` 的域语义。 */
function isValidMaybeUnknown(value: unknown, checkValue: (v: unknown) => boolean): boolean {
  if (!isPlainObject(value)) return false
  if (value.known === true) return 'value' in value && checkValue(value.value)
  if (value.known === false) {
    return (
      typeof value.reason === 'string' &&
      (value.reason === 'not_recorded_by_source' ||
        value.reason === 'not_applicable' ||
        value.reason === 'source_ambiguous')
    )
  }
  return false
}

const isStringMaybeUnknown = (v: unknown): boolean => isValidMaybeUnknown(v, (x) => typeof x === 'string')
const isNumberMaybeUnknown = (v: unknown): boolean => isValidMaybeUnknown(v, (x) => typeof x === 'number')

/**
 * 已知值必须是有限、落在 [0,1] 的比率。`NaN` 在 JS 里 `typeof` 是 `'number'`，
 * 且 `NaN < x` / `NaN > x` 恒为 `false` —— 不额外判有限性就会让畸形置信度
 * 悄悄通过下游的阈值比较。用于 confidence 一类「已知就必须是合法比率」的字段。
 */
const isRatioMaybeUnknown = (v: unknown): boolean =>
  isValidMaybeUnknown(v, (x) => typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= 1)

// ── 采集身份 ──────────────────────────────────────────────────────────────────

/**
 * 校验一份 {@link GeoAcquisitionIdentity}：七项齐全，`sample` 拆成三层
 * （GEO 契约 §3.1 / §3.2）。
 */
export function validateGeoAcquisitionIdentity(input: unknown): GeoValidationResult {
  if (!isPlainObject(input)) return fail('acquisition identity must be an object')

  const REQUIRED_TOP: readonly (keyof GeoAcquisitionIdentity)[] = [
    'querySetVersion',
    'queryKey',
    'engineFamily',
    'modelVersion',
    'locale',
    'market',
    'sample',
  ]
  for (const key of REQUIRED_TOP) {
    if (!(key in input)) return fail(`acquisition identity missing "${key}"`)
  }

  for (const key of ['querySetVersion', 'queryKey', 'engineFamily', 'modelVersion', 'locale', 'market'] as const) {
    if (!isStringMaybeUnknown(input[key])) {
      return fail(`acquisition identity "${key}" must be a known/unknown string`)
    }
  }

  const sample = input.sample
  if (!isPlainObject(sample)) return fail('acquisition identity "sample" must be an object')

  if (!('samplePlan' in sample) || !('sampleIndex' in sample) || !('samplingParameters' in sample)) {
    return fail('sample must carry all three sub-concepts: samplePlan, sampleIndex, samplingParameters')
  }

  const samplePlan = sample.samplePlan
  const validSamplePlan =
    isPlainObject(samplePlan) &&
    (('known' in samplePlan && samplePlan.known === false && isValidMaybeUnknown(samplePlan, () => true)) ||
      ('known' in samplePlan &&
        samplePlan.known === true &&
        isPlainObject((samplePlan as { value?: unknown }).value) &&
        typeof (samplePlan as { value: { plannedCount?: unknown } }).value.plannedCount === 'number'))
  if (!validSamplePlan) return fail('sample.samplePlan must be known {plannedCount:number} or explicitly unknown')

  if (!isNumberMaybeUnknown(sample.sampleIndex)) {
    return fail('sample.sampleIndex must be a known/unknown number')
  }

  const samplingParameters = sample.samplingParameters
  const validSamplingParameters =
    isPlainObject(samplingParameters) &&
    (('known' in samplingParameters &&
      samplingParameters.known === false &&
      isValidMaybeUnknown(samplingParameters, () => true)) ||
      ('known' in samplingParameters &&
        samplingParameters.known === true &&
        isPlainObject((samplingParameters as { value?: unknown }).value)))
  if (!validSamplingParameters) {
    return fail('sample.samplingParameters must be known {[key:string]:JSON} or explicitly unknown')
  }

  return OK
}

// ── 解释身份 ──────────────────────────────────────────────────────────────────

/** 校验一份 {@link GeoInterpretationIdentity}（GEO 契约 §3.3）。 */
export function validateGeoInterpretationIdentity(input: unknown): GeoValidationResult {
  if (!isPlainObject(input)) return fail('interpretation identity must be an object')
  if (!('parserVersion' in input) || !('metricRulesVersion' in input)) {
    return fail('interpretation identity requires parserVersion and metricRulesVersion')
  }
  if (!isStringMaybeUnknown(input.parserVersion)) {
    return fail('interpretation identity "parserVersion" must be a known/unknown string')
  }
  if (!isStringMaybeUnknown(input.metricRulesVersion)) {
    return fail('interpretation identity "metricRulesVersion" must be a known/unknown string')
  }
  return OK
}

// ── 证据 ──────────────────────────────────────────────────────────────────────

/** 校验一份 {@link GeoEvidence}（GEO 契约 §4.4）。 */
export function validateGeoEvidence(input: unknown): GeoValidationResult {
  if (!isPlainObject(input)) return fail('evidence must be an object')
  if (!isNonEmptyString(input.evidenceId)) return fail('evidence requires a non-empty evidenceId')
  if (!isNonEmptyString(input.observationId)) return fail('evidence requires a non-empty observationId')
  if (!isStringMaybeUnknown(input.rawResponseLocator)) {
    return fail('evidence "rawResponseLocator" must be a known/unknown string')
  }
  if (!Array.isArray(input.citations)) return fail('evidence "citations" must be an array')

  for (let i = 0; i < input.citations.length; i++) {
    const citation = input.citations[i]
    if (!isPlainObject(citation)) return fail(`citations[${i}] must be an object`)
    if (!isNonEmptyString(citation.url)) return fail(`citations[${i}].url must be a non-empty string`)
    if (!isNonEmptyString(citation.domain)) return fail(`citations[${i}].domain must be a non-empty string`)
    if (!isValidMaybeUnknown(citation.ownedDomain, (v) => typeof v === 'boolean')) {
      return fail(`citations[${i}].ownedDomain must be a known/unknown boolean`)
    }
    const ownedPage = citation.ownedPage
    if (!isPlainObject(ownedPage)) return fail(`citations[${i}].ownedPage must be an object`)
    if (
      ownedPage.status !== 'associated' &&
      ownedPage.status !== 'not_associated' &&
      ownedPage.status !== 'not_computable'
    ) {
      return fail(`citations[${i}].ownedPage.status must be associated | not_associated | not_computable`)
    }
    if (ownedPage.status === 'associated' && !isNonEmptyString(ownedPage.pageRef)) {
      return fail(`citations[${i}].ownedPage.pageRef is required when status is "associated"`)
    }
    if (ownedPage.status === 'not_computable' && !isNonEmptyString(ownedPage.reason)) {
      return fail(`citations[${i}].ownedPage.reason is required when status is "not_computable"`)
    }
  }

  return OK
}

// ── 观测 ──────────────────────────────────────────────────────────────────────

/** 校验一份 {@link GeoObservation}（GEO 契约 §4.3）。 */
export function validateGeoObservation(input: unknown): GeoValidationResult {
  if (!isPlainObject(input)) return fail('observation must be an object')
  if (!isNonEmptyString(input.observationId)) return fail('observation requires a non-empty observationId')
  if (!isNonEmptyString(input.batchId)) return fail('observation requires a non-empty batchId')

  const acquisition = validateGeoAcquisitionIdentity(input.acquisition)
  if (!acquisition.ok) return fail(`observation.acquisition: ${acquisition.reason}`)

  const interpretation = validateGeoInterpretationIdentity(input.interpretation)
  if (!interpretation.ok) return fail(`observation.interpretation: ${interpretation.reason}`)

  if (!isRatioMaybeUnknown(input.confidence)) {
    return fail('observation "confidence" must be a known/unknown finite ratio in [0,1]')
  }
  if (!isParseableTimestamp(input.observedAt)) return fail('observation "observedAt" must be a parseable timestamp')

  const outcome = input.outcome
  if (!isPlainObject(outcome)) return fail('observation "outcome" must be an object')
  if (outcome.ok === true) {
    if (!isNonEmptyString(outcome.evidenceId)) return fail('outcome.ok=true requires a non-empty evidenceId')
  } else if (outcome.ok === false) {
    if (!isNonEmptyString(outcome.errorCode)) return fail('outcome.ok=false requires a non-empty errorCode')
    if (!isStringMaybeUnknown(outcome.errorMessage)) {
      return fail('outcome.errorMessage must be a known/unknown string')
    }
  } else {
    return fail('observation.outcome.ok must be a boolean')
  }

  return OK
}

// ── 指标 ──────────────────────────────────────────────────────────────────────

function validateMetricResult(input: unknown, label: string, expectedMetricKey: string): GeoValidationResult {
  if (!isPlainObject(input)) return fail(`${label} must be an object`)
  if (input.metricKey !== expectedMetricKey) {
    return fail(`${label}.metricKey must be "${expectedMetricKey}", got ${JSON.stringify(input.metricKey)}`)
  }

  const value = input.value
  if (!isPlainObject(value)) return fail(`${label}.value must be an object`)
  if (value.computable === true) {
    if (typeof value.value !== 'number') return fail(`${label}.value.value must be a number when computable`)
  } else if (value.computable === false) {
    if (!isNonEmptyString(value.reason)) return fail(`${label}.value.reason is required when not computable`)
  } else {
    return fail(`${label}.value.computable must be a boolean`)
  }

  if (!isStringMaybeUnknown(input.metricRulesVersion)) {
    return fail(`${label}.metricRulesVersion must be a known/unknown string`)
  }
  if (typeof input.sampleSize !== 'number' || input.sampleSize < 0) {
    return fail(`${label}.sampleSize must be a non-negative number`)
  }
  return OK
}

function validateConditionalRank(input: unknown): GeoValidationResult {
  if (!isPlainObject(input)) return fail('conditionalRank must be an object')
  if (!isStringMaybeUnknown(input.metricRulesVersion)) {
    return fail('conditionalRank.metricRulesVersion must be a known/unknown string')
  }
  if (typeof input.sampleSize !== 'number' || input.sampleSize < 0) {
    return fail('conditionalRank.sampleSize must be a non-negative number')
  }

  const value = input.value
  if (!isPlainObject(value)) return fail('conditionalRank.value must be an object')
  if (value.applicable === false) {
    // 未提及 —— 结构上没有 rank，且不许附带别的字段冒充结果。
    return OK
  }
  if (value.applicable === true) {
    if (value.computable === true) {
      if (typeof value.rank !== 'number' || value.rank <= 0) {
        return fail('conditionalRank.value.rank must be a positive number when computable')
      }
      return OK
    }
    if (value.computable === false) {
      if (!isNonEmptyString(value.reason)) return fail('conditionalRank.value.reason is required when not computable')
      return OK
    }
    return fail('conditionalRank.value.computable must be a boolean when applicable')
  }
  return fail('conditionalRank.value.applicable must be a boolean')
}

/** 校验七个指标的汇总（GEO 契约 §5）。 */
export function validateGeoMetricsSummary(input: unknown): GeoValidationResult {
  if (!isPlainObject(input)) return fail('metrics summary must be an object')

  const REQUIRED: readonly (keyof GeoMetricsSummary)[] = [
    'qualifiedMention',
    'recommendation',
    'citation',
    'ownedDomainCitation',
    'directOwnedPageCitation',
    'conditionalRank',
    'engineCoverage',
  ]
  for (const key of REQUIRED) {
    if (!(key in input)) return fail(`metrics summary missing "${key}"`)
  }

  // 🔴 每个字段必须绑定它自己的 metricKey —— 校验器不许接受挪错位置的指标结果
  // （例如把 qualified_mention 塞进 recommendation 字段）。
  const FIELD_TO_METRIC_KEY: Readonly<Record<string, string>> = {
    qualifiedMention: 'qualified_mention',
    recommendation: 'recommendation',
    citation: 'citation',
    ownedDomainCitation: 'owned_domain_citation',
    directOwnedPageCitation: 'direct_owned_page_citation',
    engineCoverage: 'engine_coverage',
  }
  for (const key of [
    'qualifiedMention',
    'recommendation',
    'citation',
    'ownedDomainCitation',
    'directOwnedPageCitation',
    'engineCoverage',
  ] as const) {
    const result = validateMetricResult(input[key], key, FIELD_TO_METRIC_KEY[key])
    if (!result.ok) return result
  }

  return validateConditionalRank(input.conditionalRank)
}
