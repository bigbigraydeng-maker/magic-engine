/**
 * Shared go-live confirmation card.
 * The approval page and the later dialog both call this. Do not build a second card.
 * Spending stays behind `settle`, which runs only after the card is confirmed.
 */

export { chooseAccountLabel } from './account'
export { gatesFromReceipt, hardChecksForGoLive } from './checks'
export type { GoLiveGate, StoredGate } from './checks'
export { decideGoLive, issueGoLive, resultLineFor } from './decide'
export type { ExecutionOutcome, GoLiveBody } from './decide'
export { goLiveSubjectKey, parsePausedDraft } from './draft'
export type { GoLiveIds, PausedDraftView } from './draft'
export { buildGoLiveFacts, cardFingerprint } from './facts'
export { parseGoLiveDecision, parseGoLiveIssue } from './http'
export { loadGoLive } from './load'
export type { GoLiveLoaded, LoadResult } from './load'
export { describeRead, isLive, settleGoLive } from './settle'
export type { ActivateAttempt, LayerRead, SettlePorts, SettleResult } from './settle'
export { publicFailure, usableLabel } from './text'
