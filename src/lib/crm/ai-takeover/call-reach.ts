/**
 * Did this phone-system call reach the guest? Pure. Shared by the AI pickup rule (pickup.ts) and the stop line
 * (stop-line.ts), so "not reached" means the same thing on both sides of the hand-over.
 *
 * Content first: the call analysis says whether the guest spoke ('yes' / 'unclear' = reached, 'no' = not reached).
 * Without an analysis, the phone system's own outcome decides: 'no_answer' / 'missed_inbound' = not reached; an
 * outcome that says they talked = reached (it may rest on call length, so it is never used to hand a guest to the AI
 * on its own — see `unknown` below). Anything else, and automated / approximate-time rows, is 'unknown'.
 *
 * Callers lean towards staff: only 'not_reached' lets the AI take a guest; 'reached' and 'unknown' keep them with staff.
 */

import { customerSpokeOf } from '@/lib/crm/customer-spoke'
import { SYSTEM_CALL_SOURCES } from '@/lib/crm/email-templates/call-evidence'

export type CallReach = 'reached' | 'not_reached' | 'unknown'

/** Call outcomes (recorded on the call itself) that mean the guest talked. */
export const CALL_TALKED_OUTCOMES: ReadonlySet<string> = new Set([
  'spoke', 'callback_set', 'not_interested', 'not_interested_now', 'do_not_call', 'do_not_contact',
])
const CALL_NOT_REACHED_OUTCOMES: ReadonlySet<string> = new Set(['no_answer', 'missed_inbound'])

export function isSystemCall(source: string | null): boolean {
  return source !== null && SYSTEM_CALL_SOURCES.includes(source)
}

/** Parsed staff-note outcomes that do NOT mean the guest was reached. */
export const NOTE_NOT_REACHED_OUTCOMES: ReadonlySet<string> = new Set(['no_answer', 'bad_number', 'dnc_cleared'])
/** A staff note written this soon after a call that did not reach the guest describes that call, not a talk. */
export const NOTE_CALL_WINDOW_MS = 10 * 60_000

export interface PhoneTouch {
  source: string | null
  occurredAt: string
  metadata: Record<string, unknown> | null
}

/**
 * The note sits right after a phone-system call that did not reach the guest: it is the staff member's record of
 * that failed call ("please follow up 2027 catalogue" after an 8-second voicemail), not a conversation.
 */
export function noteDescribesUnreachedCall(note: PhoneTouch, phone: readonly PhoneTouch[]): boolean {
  const at = Date.parse(note.occurredAt)
  if (Number.isNaN(at)) return false
  return phone.some((c) => {
    if (!isSystemCall(c.source)) return false
    const cAt = Date.parse(c.occurredAt)
    return !Number.isNaN(cAt) && cAt <= at && at - cAt <= NOTE_CALL_WINDOW_MS && callReach(c.metadata) === 'not_reached'
  })
}

/** A staff note that says the guest was reached (no parsed outcome = unsure = reached), and does not describe a failed call. */
export function noteSaysReached(note: PhoneTouch, phone: readonly PhoneTouch[]): boolean {
  if (note.metadata?.automated === true || note.metadata?.time_is_approximate === true) return false
  const o = note.metadata?.outcome
  const outcome = typeof o === 'string' && o !== '' ? o : null
  if (outcome !== null && NOTE_NOT_REACHED_OUTCOMES.has(outcome)) return false
  return !noteDescribesUnreachedCall(note, phone)
}

export function callReach(metadata: Record<string, unknown> | null): CallReach {
  const meta = metadata ?? {}
  if (meta.automated === true || meta.time_is_approximate === true) return 'unknown'
  const spoke = customerSpokeOf(meta)
  if (spoke === 'yes' || spoke === 'unclear') return 'reached'
  if (spoke === 'no') return 'not_reached'
  const outcome = typeof meta.outcome === 'string' ? meta.outcome : null
  if (outcome !== null && CALL_NOT_REACHED_OUTCOMES.has(outcome)) return 'not_reached'
  if (outcome !== null && CALL_TALKED_OUTCOMES.has(outcome)) return 'reached'
  return 'unknown'
}
