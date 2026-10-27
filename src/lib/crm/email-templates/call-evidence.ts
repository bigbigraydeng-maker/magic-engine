/** A phone touchpoint row, as read from contact_touchpoints. */
export interface PhoneTouch {
  occurredAt: string
  source: string | null
  metadata: Record<string, unknown> | null
}

export interface CallEvidence {
  at: string
}

function isConnected(metadata: Record<string, unknown> | null): boolean {
  if (metadata === null) return false
  if (metadata.reached === true) return true
  const talk = metadata.talk_seconds
  if (metadata.answered === true && typeof talk === 'number' && talk > 0) return true
  return metadata.outcome === 'spoke'
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
    if (touch.source === 'me_manual') continue
    if (!isConnected(touch.metadata)) continue
    const ms = Date.parse(touch.occurredAt)
    if (Number.isNaN(ms) || ms < cutoff || ms > now.getTime() + 5 * 60_000) continue
    if (best === null || ms > best.ms) best = { ms, at: touch.occurredAt }
  }
  return best === null ? null : { at: best.at }
}
