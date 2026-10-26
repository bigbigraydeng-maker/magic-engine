/**
 * Magic Engine 2.0 · GEO Module v1 —— 对外门面（Issue #879 / WP05）
 *
 * 这里**只有**纯 / 确定性的推理函数与类型。没有执行、没有授权、没有落库、没有 provider
 * 客户端 import、没有 GEO 复测、没有页面写入、没有 ActionKey 映射。
 *
 * 🔴 GEO Module 是 Growth 五段契约的第一个消费方：把 #883 的原始 GEO 证据，经 #879 冻结的
 *    `geo-module/m1/v1` 语义，读成 `GrowthEvidence → Finding → Prescription → ActionCandidate`，
 *    最终映射成一条 `PageOptimizationRequest`（或诚实 defer）。想让系统真做事只有一条路 ——
 *    把候选交给 Kernel 授权、提交 action_run。本模块产出的是**请求**，不是命令。
 */

export {
  GEO_M1_RULE_VERSION,
  type GeoEntityProfile,
  type GeoM1RuleVersion,
  type GeoM1ReasonCode,
  type GeoEntityMatch,
  type GeoDisambiguation,
  type GeoQualifiedMention,
  type GeoRecommendationClass,
  type GeoRankStatus,
  type GeoObservationInterpretation,
  type GeoQueryOutcome,
  type GeoCoverageSummary,
} from './types'

export {
  interpretObservation,
  normalizeText,
  validateEntityProfile,
  GeoEntityProfileError,
  DEFAULT_CONFIDENCE_THRESHOLD,
  type GeoM1Input,
} from './m1'

export { toGrowthEvidence, GEO_EVIDENCE_SOURCE_KIND, type GeoEvidenceInput } from './evidence'

export {
  summarizeCoverage,
  buildQualifiedMentionFinding,
  hasVisibilityGap,
  GEO_QUALIFIED_MENTION_FINDING_REF,
} from './finding'

export { buildPrescription } from './prescription'

export {
  buildCandidate,
  GEO_CANDIDATE_DOMAIN,
  GEO_CANDIDATE_INTENT,
  type BuildCandidateInput,
} from './candidate'

export {
  buildQualifiedMentionVerification,
  ROMAN_BASELINE_BATCH_ID,
  DEFAULT_VERIFICATION_WINDOW_DAYS,
  type BuildVerificationInput,
} from './verification'

export {
  resolveLedgerPage,
  buildPageOptimizationRequest,
  type SitePageRow,
  type GeoPageRequestReason,
  type PageResolutionResult,
  type BuildPageRequestInput,
  type BuildPageRequestResult,
} from './page-request'

export {
  runGeoModule,
  GeoModuleTenantError,
  GeoModuleInvariantError,
  type GeoObservationRecord,
  type GeoModulePipelineInput,
  type GeoModuleChain,
  type GeoModuleOutcome,
  type GeoModuleDeferReason,
} from './pipeline'

export {
  evaluateQualifiedMentionVerdict,
  type GeoVerificationVerdict,
  type GeoVerificationReasonCode,
  type GeoVerificationSide,
  type GeoVerificationInput,
  type GeoVerificationOutcome,
  type GeoRate,
} from './verdict'
