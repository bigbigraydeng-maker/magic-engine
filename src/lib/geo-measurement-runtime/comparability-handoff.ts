/**
 * Magic Engine 2.0 · GEO Measurement Runtime —— 可比性接线点（Issue #874 / WP04）
 *
 * 🔴 WP04 不判定"能不能比"，只产出 {@link evaluateGeoComparability} 需要的
 *    真实输入。任何 matched/comparable 结论都必须经过 WP02 那一个函数
 *    （Build Control Room 2026-08-11 WP04 裁定第7条 + 2026-08-11 discovery Q10）。
 */

import type { GeoComparabilityCohortInput, GeoCoverageDescriptor, GeoMaybeUnknown, GeoObservation } from '@/lib/geo-measurement'

/** 批次级质量信号：这一批的引擎覆盖率与失败率，独立于单条观测的 confidence。 */
export function computeGeoBatchQuality(
  actualCoverage: GeoCoverageDescriptor,
  plannedCoverage: GeoCoverageDescriptor,
): { readonly engineCoverage: GeoMaybeUnknown<number>; readonly failureRate: GeoMaybeUnknown<number> } {
  const engineCoverage: GeoMaybeUnknown<number> =
    plannedCoverage.engines.length > 0
      ? { known: true, value: actualCoverage.engines.length / plannedCoverage.engines.length }
      : { known: false, reason: 'not_applicable' }

  const failureRate: GeoMaybeUnknown<number> =
    actualCoverage.attempted > 0
      ? { known: true, value: actualCoverage.failed / actualCoverage.attempted }
      : { known: false, reason: 'not_applicable' }

  return { engineCoverage, failureRate }
}

/**
 * 把一条 WP04 产出的原生观测投影成 WP02 `evaluateGeoComparability` 需要的
 * 一侧输入。**不自己判定可比性** —— 只负责把真实字段搬过去。
 */
export function toGeoComparabilityCohortInput(
  observation: GeoObservation,
  batchQuality: { readonly engineCoverage: GeoMaybeUnknown<number>; readonly failureRate: GeoMaybeUnknown<number> },
): GeoComparabilityCohortInput {
  return {
    acquisition: observation.acquisition,
    interpretation: observation.interpretation,
    confidence: observation.confidence,
    engineCoverage: batchQuality.engineCoverage,
    failureRate: batchQuality.failureRate,
  }
}
