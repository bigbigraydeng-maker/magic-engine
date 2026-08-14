/**
 * Magic Engine 2.0 · 站点页面台账（canonical inventory）· Issue #930 · WP05 前置
 *
 * 用法（三步，中间那步是人）：
 *
 *   1. `discoverCandidateUrls(domain)`                → 复用现有发现能力拿原始 URL
 *      `buildInventoryPlan({...})`                    → **不写库**的候选计划，全部 pending
 *   2. 人逐条判 → `applyReviewDecisions(plan, {...})`  → 带签名与新哈希的复核计划
 *   3. `activateReviewedPlan({...})`                   → 闸门全过才抓、全成才写、精确对账
 *
 * ⚠️ 第 3 步需要一个 `CanonicalInventoryStore` 实现。本 PR **故意不提供**生产实现，
 *    也没有任何 route / cron / UI 调用它 —— 激活是单独授权的动作。
 */

export {
  INVENTORY_PLAN_CONTRACT_VERSION,
  NORMALIZATION_RULE_VERSION,
  type AcceptedPageRecord,
  type ActivationAudit,
  type ActivationBlocker,
  type ActivationCounts,
  type ActivationDeps,
  type ActivationExpectation,
  type ActivationStatus,
  type CandidateDecision,
  type CanonicalInventoryPlan,
  type CanonicalInventoryStore,
  type HostBoundary,
  type InventoryCandidate,
  type InventoryPlanCounts,
  type NormalisationNote,
  type PlanReview,
  type RejectionReasonCode,
  type ReviewedInventoryPlan,
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
  InventoryPlanError,
  applyReviewDecisions,
  buildInventoryPlan,
  computePlanHash,
  countCandidates,
  verifyPlanHash,
  type ApplyReviewInput,
  type BuildInventoryPlanInput,
  type ReviewDecision,
} from './plan'

export { activateReviewedPlan, type ActivateInput } from './activation'

export { createActivationDeps, createCrawlAdapter, discoverCandidateUrls } from './adapters'
