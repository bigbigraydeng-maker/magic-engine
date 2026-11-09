/**
 * Repeat-message detection for the smart auto-ack.
 *
 * Two independent guards:
 *  - shouldSkipRepeatedMessage: suppresses a reply when the customer re-sends a
 *    Meta click-to-message pre-filled opener that we already answered earlier in
 *    the same conversation (whitelist only — never arbitrary repeated text).
 *  - isSameAsLastOutbound: suppresses a model-generated reply that is identical
 *    (after normalisation) to the last outbound message.
 *
 * Pure functions, no I/O.
 */

import { squashText } from './normalize'

/** Human-readable Meta click-to-message pre-filled openers. */
const PREFILLED_OPENERS_SOURCE: readonly string[] = [
  'Hello! Can I get more info on this?',
  "Hi, I'm interested and I'd like more information.",
  'Hi! Can I get more info on this?',
  'Hello, I would like more information',
  'Hi, can I get more info',
  "I'm interested in this",
  'Can I get more info on this',
]

/** Normalised (squashText) forms of the pre-filled openers. */
export const PREFILLED_PHRASES: readonly string[] = PREFILLED_OPENERS_SOURCE.map(squashText)

/** Minimum squashed length for a pre-filled opener to be considered for skipping. */
const MIN_OPENER_LENGTH = 12

/** True when `text` normalises to one of the known pre-filled openers. */
export function isPrefilledOpener(text: string): boolean {
  const squashed = squashText(text)
  if (squashed.length === 0) return false
  return PREFILLED_PHRASES.includes(squashed)
}

/**
 * True only when `current` is a pre-filled opener, is long enough to be
 * meaningful, and the customer already sent the same opener earlier in this
 * conversation and it received a reply.
 */
export function shouldSkipRepeatedMessage(input: {
  current: string
  repliedEarlierInbound: string[]
}): boolean {
  const squashed = squashText(input.current)
  if (squashed.length < MIN_OPENER_LENGTH) return false
  if (!PREFILLED_PHRASES.includes(squashed)) return false
  return input.repliedEarlierInbound.some((earlier) => squashText(earlier) === squashed)
}

/**
 * True when `candidate` normalises to the same non-empty text as
 * `lastOutbound`. Intended for model-generated text only.
 */
export function isSameAsLastOutbound(candidate: string, lastOutbound: string | null): boolean {
  if (lastOutbound === null) return false
  const squashedCandidate = squashText(candidate)
  if (squashedCandidate.length === 0) return false
  return squashedCandidate === squashText(lastOutbound)
}
