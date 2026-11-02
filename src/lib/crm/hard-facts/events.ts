import type { HardFactEvent, HardFactsOptions, HardFactsTouchpoint } from './types'

/** Default minimum talk seconds for a call to count as a real conversation. */
export const DEFAULT_MIN_CALL_TALK_SECONDS = 30

/**
 * True when the touchpoint represents a real phone conversation:
 * not unanswered, not voicemail, and talk time at or above the threshold.
 */
export function isRealTalk(t: HardFactsTouchpoint, minSeconds: number): boolean {
  return (
    t.unansweredCall !== true &&
    t.voicemail !== true &&
    typeof t.talkSeconds === 'number' &&
    t.talkSeconds >= minSeconds
  )
}

/**
 * Normalise a touchpoint's direction: an inbound-stored touchpoint that was
 * actually sent by our own staff is treated as outbound. Otherwise unchanged.
 */
export function normaliseDirection(
  t: HardFactsTouchpoint,
  opts: Pick<HardFactsOptions, 'isOwnStaffSender'>,
): HardFactsTouchpoint {
  if (t.direction === 'inbound' && opts.isOwnStaffSender?.(t) === true) {
    return { ...t, direction: 'outbound' }
  }
  return t
}

/**
 * Classify a single touchpoint into a HardFactEvent, or null when the
 * timestamp is invalid. Rules are applied in order; the first match wins.
 */
export function classifyTouchpoint(
  t: HardFactsTouchpoint,
  opts: Pick<HardFactsOptions, 'isOwnStaffSender' | 'minCallTalkSeconds'> = {},
): HardFactEvent | null {
  if (Number.isNaN(Date.parse(t.occurredAt))) return null

  const at = t.occurredAt
  const channel = t.channel
  const minSeconds = opts.minCallTalkSeconds ?? DEFAULT_MIN_CALL_TALK_SECONDS

  // 1. Internal note the customer never saw.
  if (t.internalNote === true) {
    return { at, channel, kind: 'note', sub: 'other' }
  }

  // 2. Snooze / unsnooze button action.
  if (t.action) {
    return { at, channel, kind: 'note', sub: 'other' }
  }

  // 3. Email open / click (any direction).
  if (t.engagement) {
    return { at, channel, kind: 'engagement', sub: 'other' }
  }

  // 4. Determine effective direction.
  const staffStored = t.direction === 'inbound' && opts.isOwnStaffSender?.(t) === true
  const outbound = t.direction === 'outbound' || staffStored

  // 5. Real inbound.
  if (!outbound) {
    if (t.automated === true || t.botReply === true) {
      return { at, channel, kind: 'out_auto', sub: 'other' }
    }
    if (channel === 'phone') {
      const talked = isRealTalk(t, minSeconds)
      return {
        at,
        channel,
        kind: 'in_human',
        sub: talked ? 'call_talk' : 'missed_call',
        promise: t.promise === true,
      }
    }
    if (channel === 'meta_lead_form' || channel === 'web_form') {
      return { at, channel, kind: 'in_human', sub: 'form' }
    }
    return { at, channel, kind: 'in_human', sub: 'message' }
  }

  // 6. Outbound.
  if (t.automated === true || t.botReply === true) {
    return { at, channel, kind: 'out_auto', sub: 'other' }
  }
  if (channel === 'phone') {
    if (isRealTalk(t, minSeconds)) {
      return { at, channel, kind: 'out_human', sub: 'call_talk', promise: t.promise === true }
    }
    if (
      typeof t.talkSeconds !== 'number' &&
      t.outcome === 'spoke' &&
      t.unansweredCall !== true &&
      t.voicemail !== true
    ) {
      return { at, channel, kind: 'out_human', sub: 'logged_contact' }
    }
    return { at, channel, kind: 'out_attempt', sub: 'other' }
  }
  return { at, channel, kind: 'out_human', sub: 'message' }
}
