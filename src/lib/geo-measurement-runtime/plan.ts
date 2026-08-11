/**
 * Magic Engine 2.0 · GEO Measurement Runtime —— 计划校验与展开（Issue #874 / WP04）
 *
 * 🔴 纯函数。不调用 provider、不落库、不猜测缺失字段 —— 任何一项显式维度缺失
 *    都 fail closed（Build Control Room 2026-08-11 WP04 裁定第2条）。
 */

import type { GeoRuntimePlan, GeoRuntimeQuery } from './types'

export type GeoRuntimePlanValidation = { readonly ok: true } | { readonly ok: false; readonly reason: string }

/**
 * 一个批次能装下的观测数硬顶。**调用方不能通过 `maxPlannedObservations`
 * 绕过它** —— 一次批次绝不允许把整个查询集塞进一次长时运行的 serverless
 * 执行（Build Control Room 2026-08-11 WP04 裁定第3条）。
 */
export const RUNTIME_MAX_BATCH_OBSERVATIONS = 200

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

const REQUIRED_STRING_FIELDS: readonly (keyof GeoRuntimePlan)[] = [
  'clientId',
  'querySetId',
  'querySetVersion',
  'parserVersion',
  'metricRulesVersion',
  'triggeredBy',
]

function validateRequiredStrings(plan: GeoRuntimePlan): GeoRuntimePlanValidation {
  for (const field of REQUIRED_STRING_FIELDS) {
    if (!isNonEmptyString(plan[field])) return { ok: false, reason: `plan.${field} is required` }
  }
  return { ok: true }
}

function validateCohort(plan: GeoRuntimePlan): GeoRuntimePlanValidation {
  if (!plan.cohort) return { ok: false, reason: 'plan.cohort is required' }
  for (const key of ['engineFamily', 'modelVersion', 'locale', 'market'] as const) {
    if (!isNonEmptyString(plan.cohort[key])) return { ok: false, reason: `plan.cohort.${key} is required` }
  }
  return { ok: true }
}

function validateQueries(plan: GeoRuntimePlan): GeoRuntimePlanValidation {
  if (!Array.isArray(plan.queries) || plan.queries.length === 0) {
    return { ok: false, reason: 'plan.queries must be a non-empty explicit list' }
  }
  const seenQueryKeys = new Set<string>()
  for (const [i, query] of plan.queries.entries()) {
    if (!isNonEmptyString(query.queryKey)) return { ok: false, reason: `plan.queries[${i}].queryKey is required` }
    if (!isNonEmptyString(query.questionText)) return { ok: false, reason: `plan.queries[${i}].questionText is required` }
    if (seenQueryKeys.has(query.queryKey)) {
      return { ok: false, reason: `plan.queries contains duplicate queryKey "${query.queryKey}"` }
    }
    seenQueryKeys.add(query.queryKey)
  }
  return { ok: true }
}

/** 样本计划 + 观测数上限：显式、正整数、不超过硬顶，且展开后不超过声明的上限。 */
function validateSamplePlanAndBounds(plan: GeoRuntimePlan): GeoRuntimePlanValidation {
  if (!plan.samplePlan || !isPositiveInteger(plan.samplePlan.plannedCount)) {
    return { ok: false, reason: 'plan.samplePlan.plannedCount must be an explicit positive integer' }
  }
  if (!isPositiveInteger(plan.maxPlannedObservations)) {
    return { ok: false, reason: 'plan.maxPlannedObservations must be an explicit positive integer' }
  }
  if (plan.maxPlannedObservations > RUNTIME_MAX_BATCH_OBSERVATIONS) {
    return {
      ok: false,
      reason: `plan.maxPlannedObservations (${plan.maxPlannedObservations}) exceeds the runtime hard ceiling of ${RUNTIME_MAX_BATCH_OBSERVATIONS}`,
    }
  }

  const computedTotal = plan.queries.length * plan.samplePlan.plannedCount
  if (computedTotal > plan.maxPlannedObservations) {
    return {
      ok: false,
      reason: `plan expands to ${computedTotal} observations (queries=${plan.queries.length} × plannedCount=${plan.samplePlan.plannedCount}), which exceeds maxPlannedObservations (${plan.maxPlannedObservations})`,
    }
  }
  if (computedTotal > RUNTIME_MAX_BATCH_OBSERVATIONS) {
    return {
      ok: false,
      reason: `plan expands to ${computedTotal} observations, which exceeds the runtime hard ceiling of ${RUNTIME_MAX_BATCH_OBSERVATIONS}`,
    }
  }

  return { ok: true }
}

export function validateGeoRuntimePlan(plan: GeoRuntimePlan): GeoRuntimePlanValidation {
  const requiredStrings = validateRequiredStrings(plan)
  if (!requiredStrings.ok) return requiredStrings

  const cohort = validateCohort(plan)
  if (!cohort.ok) return cohort

  const queries = validateQueries(plan)
  if (!queries.ok) return queries

  return validateSamplePlanAndBounds(plan)
}

/** 展开成一条确定性的计划观测列表：query × sampleIndex（0 基）。 */
export interface GeoPlannedObservationSlot {
  readonly query: GeoRuntimeQuery
  readonly sampleIndex: number
}

export function expandGeoRuntimePlan(plan: GeoRuntimePlan): readonly GeoPlannedObservationSlot[] {
  const slots: GeoPlannedObservationSlot[] = []
  for (const query of plan.queries) {
    for (let sampleIndex = 0; sampleIndex < plan.samplePlan.plannedCount; sampleIndex++) {
      slots.push({ query, sampleIndex })
    }
  }
  return slots
}
