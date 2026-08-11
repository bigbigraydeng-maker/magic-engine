import { parseMarker } from './marker'
import type { RelayConfig } from './config'

export interface CommentLike {
  readonly id: number
  readonly body: string
  readonly login: string
  readonly userType: 'User' | 'Bot' | string
  readonly authorAssociation: string
}

export type SkipReason =
  | 'own_comment'
  | 'untrusted_actor'
  | 'duplicate_comment'
  | 'already_halted'

export type Decision =
  | { readonly kind: 'skip'; readonly reason: SkipReason }
  | { readonly kind: 'halt'; readonly sourceCommentId: number }
  | { readonly kind: 'relay'; readonly round: number; readonly sourceCommentId: number }

function isTrustedActor(comment: CommentLike, config: RelayConfig): boolean {
  const isClaudeBot = comment.userType === 'Bot' && config.trustedBotLogins.includes(comment.login)
  const isOwnerRelayRequest =
    comment.authorAssociation === 'OWNER' && comment.body.includes(config.relayPhrase)
  return isClaudeBot || isOwnerRelayRequest
}

/**
 * Pure. Given the triggering comment and the Issue's full comment history
 * (already fetched, oldest first), decide what this run should do. No
 * network call, no side effect — every branch here is unit-tested directly.
 *
 * The trigger's own marker (if the caller already appended it to `history`)
 * is ignored automatically: `alreadyProcessed` and the round scan only ever
 * look for OTHER comments whose marker names `trigger.id` as their source,
 * which the trigger comment itself never does.
 */
export function decide(
  trigger: CommentLike,
  history: readonly CommentLike[],
  config: RelayConfig
): Decision {
  if (trigger.login === config.workflowBotLogin) {
    return { kind: 'skip', reason: 'own_comment' }
  }

  if (!isTrustedActor(trigger, config)) {
    return { kind: 'skip', reason: 'untrusted_actor' }
  }

  let highestRound = 0
  let halted = false
  let alreadyProcessed = false

  for (const comment of history) {
    const marker = parseMarker(comment.body)
    if (!marker) continue
    if (marker.sourceCommentId === trigger.id) alreadyProcessed = true
    if (marker.round === 'halt') {
      halted = true
      continue
    }
    if (marker.round > highestRound) highestRound = marker.round
  }

  if (alreadyProcessed) return { kind: 'skip', reason: 'duplicate_comment' }
  if (halted) return { kind: 'skip', reason: 'already_halted' }

  const nextRound = highestRound + 1
  if (nextRound > config.maxRounds) {
    return { kind: 'halt', sourceCommentId: trigger.id }
  }

  return { kind: 'relay', round: nextRound, sourceCommentId: trigger.id }
}
