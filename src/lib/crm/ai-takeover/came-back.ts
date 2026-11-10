/**
 * "The guest came back" while the AI was following them up. Pure.
 *
 * Same notion of "the customer reached out" as the do-not-contact re-engage check (dnc-reengage.ts `touchKind`):
 * a Facebook or website form, an answered inbound call (≥15 s), a real reply email (not Mailchimp, not an auto-reply,
 * not "stop"). Here an inbound Messenger / WhatsApp message also counts: showing the guest to staff again is the
 * cheap direction to get wrong, unlike lifting a do-not-contact.
 *
 * Only touches strictly after the takeover-on time count. Mailchimp opens / clicks never count (outbound engagement).
 * Times more than FUTURE_TOLERANCE_MS after "now" are not trusted (a client-typed time can be set in the future).
 */

import { FUTURE_TOLERANCE_MS, touchKind, type ReengageKind, type ReengageTouch } from '@/lib/crm/dnc-reengage'
import { isAutomatedTouch } from '@/lib/crm/automated-touch'
import { takeoverState, type TakeoverEvent, type TakeoverState } from './state'

export type CameBackKind = ReengageKind

export interface CameBack {
  kind: CameBackKind
  at: string
}

/** The touchpoint columns this check needs (contact_touchpoints row shape). */
export interface CameBackRow {
  channel: string
  direction: 'inbound' | 'outbound'
  occurred_at: string
  summary?: string | null
  raw: string | null
  metadata: Record<string, unknown> | null
  source: string | null
}

export function toReengageTouchRow(r: CameBackRow): ReengageTouch {
  const meta = r.metadata ?? {}
  return {
    id: '',
    source: r.source,
    channel: r.channel,
    direction: r.direction,
    occurredAt: r.occurred_at,
    outcome: typeof meta.outcome === 'string' ? meta.outcome : null,
    flagged: meta.do_not_contact === true,
    subject: typeof meta.subject === 'string' ? meta.subject : (r.summary ?? null),
    body: r.raw,
    automated: isAutomatedTouch(r.source, meta),
    talkSeconds: typeof meta.talk_seconds === 'number' ? meta.talk_seconds : null,
  }
}

function kindOf(t: ReengageTouch): CameBackKind | null {
  const k = touchKind(t)
  if (k !== null) return k
  const isChat = t.channel === 'messenger' || t.channel === 'whatsapp'
  if (isChat && t.direction === 'inbound' && t.automated !== true && (t.body ?? '').trim() !== '') return 'message'
  return null
}

function ms(v: string): number {
  const t = Date.parse(v)
  return Number.isNaN(t) ? Number.NaN : t
}

/** The earliest customer reach-out after `since`, or null. */
export function customerCameBack(touches: readonly ReengageTouch[], since: string, now: Date): CameBack | null {
  const from = ms(since)
  if (Number.isNaN(from)) return null
  const latestOk = now.getTime() + FUTURE_TOLERANCE_MS
  let best: CameBack | null = null
  for (const t of touches) {
    const at = ms(t.occurredAt)
    if (Number.isNaN(at) || at <= from || at > latestOk) continue
    const kind = kindOf(t)
    if (kind === null) continue
    if (best === null || at < ms(best.at)) best = { kind, at: t.occurredAt }
  }
  return best
}

/** Takeover state plus "came back" since it went on (null when not in takeover). */
export function takeoverView(
  events: readonly TakeoverEvent[],
  touches: readonly ReengageTouch[],
  now: Date,
): { takeover: TakeoverState; cameBack: CameBack | null } {
  const takeover = takeoverState(events)
  return { takeover, cameBack: takeover.on ? customerCameBack(touches, takeover.since, now) : null }
}
