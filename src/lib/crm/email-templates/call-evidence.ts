/** A phone touchpoint row, as read from contact_touchpoints. */
export interface PhoneTouch {
  occurredAt: string
  source: string | null
  metadata: Record<string, unknown> | null
}

export interface CallEvidence {
  at: string
}

/**
 * The ONLY touchpoint sources that are a telephony system's own record of a call. An allowlist, not "anything
 * except typed notes": other sources also write phone touchpoints (spreadsheet follow-up imports, the AI voice
 * agent) whose `outcome` is a parser fallback or an automated call, and none of them is "he just spoke to us".
 * A new telephony provider must be added here on purpose.
 *
 * These are the raw `contact_touchpoints.source` values: the telephony writer stores the provider's own name there
 * (`source: conn.provider` in telephony/voipline/process.ts; production holds 'twilio' today). They are NOT the
 * "channel/source" kind keys ('phone/twilio') that ENQUIRY_INBOUND_SOURCES uses to name a touch: no row stores those.
 */
export const SYSTEM_CALL_SOURCES: readonly string[] = ['twilio', 'voipline']

function isConnected(metadata: Record<string, unknown> | null): boolean {
  if (metadata === null) return false
  // imported spreadsheet notes carry an approximate time; automated (AI agent) calls are not a staff conversation
  if (metadata.automated === true || metadata.time_is_approximate === true) return false
  if (metadata.reached === true) return true
  const talk = metadata.talk_seconds
  // `outcome === 'spoke'` alone is deliberately NOT enough: it is also the note parser's catch-all value
  return metadata.answered === true && typeof talk === 'number' && talk > 0
}

/**
 * The most recent CONNECTED call recorded by the telephony system within `hours` of `now`.
 *
 * A note typed by staff (source `me_manual`) is never evidence: the note parser's fallback value is `spoke`,
 * so any remark — including the bulk "sent a mass email" registration — would look like a connected call.
 * See isPhoneVerdict in crm/segments.ts for the same rule.
 */
export function findConnectedCallEvidence(
  touches: readonly PhoneTouch[],
  now: Date,
  hours: number,
): CallEvidence | null {
  const cutoff = now.getTime() - hours * 3_600_000
  let best: { ms: number; at: string } | null = null
  for (const touch of touches) {
    if (touch.source === null || !SYSTEM_CALL_SOURCES.includes(touch.source)) continue
    if (!isConnected(touch.metadata)) continue
    const ms = Date.parse(touch.occurredAt)
    if (Number.isNaN(ms) || ms < cutoff || ms > now.getTime() + 5 * 60_000) continue
    if (best === null || ms > best.ms) best = { ms, at: touch.occurredAt }
  }
  return best === null ? null : { at: best.at }
}
