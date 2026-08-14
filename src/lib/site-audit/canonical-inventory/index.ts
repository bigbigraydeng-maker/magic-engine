/**
 * Magic Engine 2.0 · 站点页面台账（canonical inventory）
 * Issue #930（WP05 前置）· Issue #960（生成时可信锚点）
 *
 * 用法（三步，中间那步是人）：
 *
 *   1. `generateSignedInventoryPlan({clientId, requestedDomain, approvedHosts}, {signer, now, newPlanId})`
 *      → 服务端自己跑发现，产出一枚**带 L1 签名**的计划信封（不写库）
 *   2. 人逐条判 → `signReview(envelope, submission, {verifyGenerationSignature, signer})`
 *      → 先验 L1，再验内容，最后盖 L2 复核完整性凭证
 *   3. `activateReviewedPlan({envelope, review, expected, mode, deps})`
 *      → 十道闸全过才抓、全成才写、精确对账
 *
 * ⚠️ 第 3 步需要一个 `CanonicalInventoryStore` 实现。本模块**故意不提供**生产实现，
 *    也没有任何 route / cron / UI 调用它 —— 激活是单独授权的动作。
 *
 * 🔴 **这里刻意不导出** `buildInventoryPlan` / `sealEnvelope` / `sealReview` /
 *    `computeGenerationDigest`。它们是内部原语：把「拿一份任意 core 去签名」这件事
 *    摆到公开门面上，等于对外提供一台替任意内容签名的机器，
 *    而 #960 的整个证明就建立在「不存在这样一台机器」之上。架构测试盯着这条。
 */

export {
  INVENTORY_PLAN_CONTRACT_VERSION,
  INVENTORY_ENVELOPE_VERSION,
  NORMALIZATION_RULE_VERSION,
  type AcceptedPageRecord,
  type ActivationAudit,
  type ActivationBlocker,
  type ActivationCounts,
  type ActivationDeps,
  type ActivationExpectation,
  type ActivationStatus,
  type CandidateDecision,
  type CanonicalInventoryStore,
  type DiscoveryOutcome,
  type GeneratedPlanCore,
  type GeneratedPlanCounts,
  type HostAcknowledgement,
  type HostBoundary,
  type HostDiscoverySummary,
  type InventoryPlanEnvelope,
  type MachineCandidate,
  type MachineDecision,
  type NormalisationNote,
  type RejectionReasonCode,
  type ReviewDecisionEntry,
  type ReviewSubmission,
  type ReviewerDecision,
  type SignedReview,
  type UnsignedEnvelope,
} from './types'

export {
  TRACKING_QUERY_KEYS,
  TRACKING_QUERY_PREFIXES,
  InventoryHostBoundaryError,
  canonicaliseUrl,
  isApprovedHost,
  deriveCanonicalUrl,
  normaliseApprovedHosts,
  type CanonicalisationResult,
} from './url-rules'

export {
  InventorySigningError,
  MIN_SIGNING_SECRET_BYTES,
  createHmacSigner,
  createHmacVerifier,
  createUnavailableVerifier,
  type PlanSigner,
  type SignatureCheck,
  type SignatureVerifier,
  type SigningKeyMaterial,
} from './signing'

export { PLAN_MAX_AGE_DAYS } from './envelope'

export { InventoryPlanError } from './plan'

export { ALLOWED_REVIEWER_IDENTITY_SOURCE, signReview, type SignReviewDeps } from './review'

export { ALLOWED_REASON_CODES, ALLOWED_REVIEWER_DECISIONS } from './decisions'

export { activateReviewedPlan, type ActivateInput } from './activation'

export {
  createActivationDeps,
  createCrawlAdapter,
  discoverCandidateUrls,
  generateSignedInventoryPlan,
  type GeneratePlanDeps,
  type GeneratePlanInput,
} from './adapters'
