/**
 * Should the AI take this guest over? Pure.
 *
 * PM 2026-11-16: "人如果打过没有真实接通，留言的，一律 AI 接走，打上 AI 标记。但是客户一旦回复了邮件，whatsapp，或者
 * 电话回拨回来，就转为人工跟进" and "完全没打过的，超过 7 天的，也由 AI 接走".
 *
 * Two rules, both counted from the guest's latest enquiry (form fill):
 *   not_reached  — staff rang through the phone system at least once and no call reached the guest
 *                  (call-reach.ts: the call analysis or the phone system says nobody spoke / no answer / voicemail)
 *   never_called — no phone record of any kind, no staff note, no staff email, the enquiry is older than N days, the
 *                  guest is still in the new-lead stage, and the enquiry came after the client's calls were tracked
 *                  (before that, "no call on record" says nothing)
 *
 * The AI never takes a guest who:
 *   · has any takeover history (a staff member or the stop line already decided once; that decision stands),
 *   · must not be contacted, has an active booking, is in a stage that is not open for marketing, is snoozed,
 *   · is a qualified lead (the client's qualified stages, e.g. quoted and after: PM 11-03, high intent stays with staff),
 *   · has no email address (the AI only follows up by email),
 *   · reached out after the enquiry (call back, reply email, WhatsApp / Messenger, another form) — staff takes them,
 *   · was reached on any call, or has a call we cannot read ('unknown' leans to staff),
 *   · got a personal email / WhatsApp / Messenger message from staff since the enquiry, or has a staff note saying the
 *     guest was reached (not one written right after a failed call), or a staff note without any phone-system call
 *     (staff may have rung from another phone; we cannot see it),
 *   · was reached on a call before this enquiry (came back with a new form after a real talk: high intent),
 *   · was mailed from the CRM mailbox since the enquiry (sent or not yet confirmed): never a second catalogue.
 * Getting it wrong in the "take" direction removes a guest from the staff list, so unknowns stay with staff.
 */

import { customerCameBack } from './came-back'
import type { ReengageTouch } from '@/lib/crm/dnc-reengage'
import { callReach, isSystemCall, noteSaysReached } from './call-reach'

export type PickupRule = 'not_reached' | 'never_called'

export interface PickupDecision {
  rule: PickupRule
  /** The enquiry the rule counted from; part of the idempotency key. */
  leadAt: string
  /** One plain sentence for staff, shown in the drawer. */
  why: string
}

/** A touchpoint after the enquiry, narrowed to what the rules read. */
export interface PickupTouch {
  channel: string
  direction: 'inbound' | 'outbound'
  source: string | null
  occurredAt: string
  metadata: Record<string, unknown> | null
}

export interface PickupInput {
  now: Date
  /** The latest enquiry (form fill); null = no enquiry in the window. */
  leadAt: string | null
  hasTakeoverHistory: boolean
  /** Already judged by the catalogue line's eligibility (do-not-contact, stage, snooze). */
  eligible: boolean
  hasActiveBooking: boolean
  hasEmail: boolean
  /** In one of the client's qualified stages (quoted and after for CTS). */
  qualified: boolean
  /** Still in the new-lead stage (or no stage yet): staff has not moved them on. */
  newLeadStage: boolean
  /** The client's earliest phone-system call; null = calls are not tracked for this client. */
  callsTrackedSince: string | null
  /** A phone-system call before this enquiry reached the guest. */
  reachedBefore: boolean
  /** An email went out (or may have gone out) from the CRM mailbox since the enquiry: a catalogue, a staff mail. */
  crmMailedSinceLead: boolean
  /** Touches after leadAt, in the came-back shape (for "the guest reached out"). */
  inbound: readonly ReengageTouch[]
  /** All touches after leadAt. */
  touches: readonly PickupTouch[]
}

export interface PickupConfig {
  /** never_called applies once the enquiry is at least this old. */
  neverCalledDays: number
  /** not_reached waits this long after the last call, so a same-day retry by staff is not overtaken. */
  afterLastCallMinutes: number
}

export const DEFAULT_PICKUP_CONFIG: PickupConfig = { neverCalledDays: 7, afterLastCallMinutes: 60 }

function ms(v: string): number {
  const t = Date.parse(v)
  return Number.isNaN(t) ? Number.NaN : t
}

const STAFF_MESSAGE_CHANNELS: ReadonlySet<string> = new Set(['email', 'whatsapp', 'messenger'])

/** A personal email / chat message from staff (not Mailchimp, not an automated send) since the enquiry: staff is on it. */
export function staffMessaged(touches: readonly PickupTouch[]): boolean {
  return touches.some((t) => STAFF_MESSAGE_CHANNELS.has(t.channel) && t.direction === 'outbound' && t.source !== 'mailchimp' && t.metadata?.automated !== true)
}

function decideCalls(calls: readonly PickupTouch[], input: PickupInput, cfg: PickupConfig): PickupDecision | null {
  if (calls.some((c) => callReach(c.metadata) !== 'not_reached')) return null
  const last = Math.max(...calls.map((c) => ms(c.occurredAt)))
  if (Number.isNaN(last) || input.now.getTime() - last < cfg.afterLastCallMinutes * 60_000) return null
  const n = calls.filter((c) => c.direction === 'outbound').length
  return { rule: 'not_reached', leadAt: input.leadAt ?? '', why: `员工打了 ${n} 次都没真正接通，交给 AI 先发目录跟进；客人回信、回电或发消息会自动转回员工。` }
}

export function decideAiPickup(input: PickupInput, cfg: PickupConfig = DEFAULT_PICKUP_CONFIG): PickupDecision | null {
  if (input.leadAt === null || Number.isNaN(ms(input.leadAt))) return null
  if (input.hasTakeoverHistory || !input.eligible || input.hasActiveBooking || !input.hasEmail || input.qualified || input.reachedBefore || input.crmMailedSinceLead) return null
  if (customerCameBack(input.inbound, input.leadAt, input.now) !== null) return null
  if (staffMessaged(input.touches)) return null

  const phone = input.touches.filter((t) => t.channel === 'phone')
  const calls = phone.filter((t) => isSystemCall(t.source))
  if (calls.length > 0) {
    // Any call the guest made is the guest reaching out (came-back usually catches it first).
    if (calls.some((c) => c.direction === 'inbound')) return null
    // Staff reached the guest some other way and wrote it down ("spoke on her mobile, call back Tuesday").
    if (phone.some((t) => !isSystemCall(t.source) && noteSaysReached(t, calls))) return null
    return decideCalls(calls, input, cfg)
  }
  // A staff note with no phone-system call: staff may have rung from another phone. We cannot see it; leave them.
  if (input.touches.some((t) => t.channel === 'phone')) return null
  if (!input.newLeadStage || input.callsTrackedSince === null) return null
  if (ms(input.leadAt) < ms(input.callsTrackedSince)) return null
  const ageMs = input.now.getTime() - ms(input.leadAt)
  if (ageMs < cfg.neverCalledDays * 86_400_000) return null
  return { rule: 'never_called', leadAt: input.leadAt, why: `询价 ${cfg.neverCalledDays} 天还没人打电话，交给 AI 先发目录跟进；客人回信、回电或发消息会自动转回员工。` }
}
