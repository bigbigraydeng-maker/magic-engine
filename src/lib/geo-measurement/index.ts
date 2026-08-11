/**
 * Magic Engine 2.0 · GEO Measurement 契约 —— 对外门面（Issue #876 / WP02）
 *
 * 这里**只有**类型与纯函数。没有执行、没有落库、没有 provider 调用、没有
 * NLP / mention 分类、没有域名归属或页面台账子系统。
 *
 * 🔴 与 `src/lib/growth/**` 平行，不 import 它、不扩展它、不被它 import ——
 *    两份契约各自冻结，同名不同事（架构测试盯着这条边界）。
 */

export type {
  GeoUnknownReason,
  GeoMaybeUnknown,
  GeoJsonValue,
  GeoSampleIdentity,
  GeoAcquisitionIdentity,
  GeoInterpretationIdentity,
  GeoQuerySetQuery,
  GeoQuerySet,
  GeoCoverageDescriptor,
  GeoBatch,
  GeoObservationOutcome,
  GeoObservation,
  GeoOwnedPageAssociation,
  GeoCitation,
  GeoEvidence,
  GeoMetricKey,
  GeoMetricValue,
  GeoMetricResult,
  GeoConditionalRankValue,
  GeoConditionalRankResult,
  GeoMetricsSummary,
  GeoComparabilityConditionId,
  GeoComparabilityMismatch,
  GeoComparabilityResult,
  GeoComparabilityPolicy,
  GeoComparabilityCohortInput,
  AiTrackerLegacyRow,
  IndustryAiVisibilityLegacyRow,
  GeoLegacyMappedObservation,
} from './types'

export { GEO_COMPARABILITY_POLICY_V1 } from './types'

export {
  validateGeoAcquisitionIdentity,
  validateGeoInterpretationIdentity,
  validateGeoEvidence,
  validateGeoObservation,
  validateGeoMetricsSummary,
  type GeoValidationResult,
} from './validators'

export { evaluateGeoComparability } from './comparability'

export { mapAiTrackerObservation, mapIndustryAiVisibilityObservation } from './legacy-mapper'
