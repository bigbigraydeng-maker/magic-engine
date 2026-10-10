/**
 * Client Knowledge Base — public surface.
 *
 * Step 1/6 (Issue #1643): `detectSensitivity` / `resolveSensitivity`.
 * Step 2/6 (Issue #1644, this module): tables + read entry point + entitlement gate.
 */

export * from './sensitivity'
export * from './types'
export * from './fingerprint'
export * from './errors'
export { getKnowledgeEntitlement, KNOWLEDGE_READ_ACTION_KEY } from './entitlement'
export type { GetKnowledgeEntitlementDeps } from './entitlement'
export { getClientKnowledge } from './read'
export type { GetClientKnowledgeDeps } from './read'

// Step 4/6 (Issue #1646): FDE review queue + customer confirmation link.
export {
  checkConfirmerIdentity,
  isAcceptableConfirmerIdentity,
  normaliseEmail,
} from './dual-sign'
export type { ConfirmerIdentityInput, ConfirmerIdentityRejection } from './dual-sign'
export {
  applyCandidateDecision,
  buildDecisionFields,
  groupCandidates,
  listFactsAwaitingCustomerConfirmation,
  listKnowledgeCandidates,
  KnowledgeReviewError,
} from './review'
export type {
  ApprovedCounterpart,
  CandidateDecision,
  CandidateGroup,
  CandidateGroupKind,
  KnowledgeCandidate,
  PendingConfirmationFact,
} from './review'
export {
  CONFIRMATION_BATCH_BLOCK_SIZE,
  CONFIRMATION_LINK_DEFAULT_TTL_HOURS,
  consumeConfirmationRequest,
  createConfirmationRequest,
  describeLinkProblem,
  generateConfirmationToken,
  hashConfirmationToken,
  KnowledgeConfirmationError,
  loadConfirmationRequest,
} from './confirmation-requests'
export type {
  ConfirmationFactView,
  ConfirmationLinkProblem,
  ConfirmationLinkResult,
  ConfirmationOutcome,
  ConsumeResult,
  FactChoice,
} from './confirmation-requests'
export { stopAiRepliesForClient, KnowledgeKillSwitchError } from './kill-switch'

// Step 6/6 (Issue #1648): rollout stage machine + dual-signature advance link.
export {
  consumeRolloutAdvanceRequest,
  createRolloutAdvanceRequest,
  describeRolloutLinkProblem,
  getCurrentRolloutStage,
  INITIAL_STAGE,
  isKnowledgeLiveForCustomerReply,
  KnowledgeRolloutError,
  LIVE_STAGE,
  loadRolloutAdvanceRequest,
  meetsSampleCheckFloor,
  rollbackKnowledgeRolloutStage,
  ROLLOUT_ADVANCE_LINK_DEFAULT_TTL_HOURS,
  ROLLOUT_SAMPLE_CHECK_FLOOR,
  ROLLOUT_STAGE_LABELS,
} from './rollout'
export type {
  ConsumeRolloutAdvanceOutcome,
  ConsumeRolloutAdvanceResult,
  CreateRolloutAdvanceRequestResult,
  KnowledgeRolloutStage,
  RollbackResult,
  RolloutAdvanceLinkProblem,
  RolloutAdvanceLinkResult,
  RolloutAdvanceLinkView,
  RolloutSampleCheck,
} from './rollout'
