/**
 * Pre-call brief: pure assembly of the card a salesperson reads before dialling.
 *
 * No I/O, no env, no database access. The caller reads `conversation_briefs`
 * (jsonb columns arrive as `unknown`), the CRM contact record and the contact's
 * touchpoints, then hands them here. Everything in this file is deterministic
 * and unit-testable.
 */

import { ContactSchema, INTENT_LEVELS, TripDetailsSchema, type TripDetails } from '@/lib/messenger/brief-schema'
import { isFormIntroBody } from './messenger-lead-intro'
import { isHumanFollowup, type LeadTouch } from './lead-followup-due'
import { isPastPromiseDue, leadPromiseDueAt } from './nz-business-days'
import type { PrecallAskItem } from './precall-profiles'

/** One row of conversation_briefs as read from the database (jsonb columns arrive as unknown). */
export interface PrecallBriefRow {
  summary: string | null
  intent_level: string | null
  next_action: string | null
  customer_needs: unknown
  promises_made: unknown
  risk_flags: unknown
  trip: unknown
  contact: unknown
  generated_at: string | null
}

export type PrecallIntent = (typeof INTENT_LEVELS)[number]

/** What the pre-call card shows. */
export interface PrecallBrief {
  summary: string | null
  intentLevel: PrecallIntent | null
  nextAction: string | null
  promisesMade: string[]
  riskFlags: string[]
  trip: TripDetails
  phone: string | null
  email: string | null
  /** Chinese labels of trip facts still empty (from the ask items). */
  askMissing: string[]
  generatedAt: string | null
}

/**
 * Keep only non-empty trimmed strings from an array. Anything that is not an
 * array, or whose entries are not strings, yields an empty list.
 */
export function toStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  for (const entry of value) {
    if (typeof entry !== 'string') continue
    const trimmed = entry.trim()
    if (trimmed.length > 0) out.push(trimmed)
  }
  return out
}

/**
 * Chinese labels of the ask items whose trip fact is still empty.
 *
 * `null` and `undefined` are missing; `false` and `0` are real answers and are
 * NOT missing. A blank string counts as missing. Ask-item order is preserved.
 */
export function listMissingTripItems(
  trip: TripDetails,
  askItems: readonly PrecallAskItem[],
): string[] {
  const missing: string[] = []
  for (const item of askItems) {
    const value = trip[item.key]
    if (value === null || value === undefined) {
      missing.push(item.label)
      continue
    }
    if (typeof value === 'string' && value.trim().length === 0) {
      missing.push(item.label)
    }
  }
  return missing
}

/** True when `value` is one of the known intent levels. */
function toIntentLevel(value: string | null): PrecallIntent | null {
  if (value === null) return null
  return (INTENT_LEVELS as readonly string[]).includes(value) ? (value as PrecallIntent) : null
}

/**
 * Assemble the pre-call card from a database row plus the CRM contact record.
 *
 * The CRM contact record wins over the brief's own contact block; the brief is
 * only a fallback (the customer may have given a number in the thread that the
 * CRM record has not caught up with yet).
 */
export function buildPrecallBrief(
  row: PrecallBriefRow | null,
  contact: { phone: string | null; email: string | null },
  askItems: readonly PrecallAskItem[],
): PrecallBrief | null {
  if (row === null) return null

  const tripResult = TripDetailsSchema.safeParse(row.trip)
  const trip = tripResult.success ? tripResult.data : TripDetailsSchema.parse({})

  const contactResult = ContactSchema.safeParse(row.contact)
  const briefContact = contactResult.success ? contactResult.data : { phone: null, email: null }

  return {
    summary: row.summary,
    intentLevel: toIntentLevel(row.intent_level),
    nextAction: row.next_action,
    promisesMade: toStringList(row.promises_made),
    riskFlags: toStringList(row.risk_flags),
    trip,
    phone: contact.phone ?? briefContact.phone,
    email: contact.email ?? briefContact.email,
    askMissing: listMissingTripItems(trip, askItems),
    generatedAt: row.generated_at,
  }
}

/** Parse a timestamp, returning null for null/invalid values. */
function parseTimestamp(value: string | null): number | null {
  if (value === null) return null
  const ms = Date.parse(value)
  return Number.isNaN(ms) ? null : ms
}

/**
 * The row with the greatest `generated_at`. Rows with a null or unparseable
 * timestamp rank lowest; an empty list yields null.
 */
export function pickLatestBriefRow<T extends { generated_at: string | null }>(
  rows: readonly T[],
): T | null {
  let best: T | null = null
  let bestMs: number | null = null
  for (const row of rows) {
    const ms = parseTimestamp(row.generated_at)
    if (ms === null) {
      if (best === null) best = row
      continue
    }
    if (bestMs === null || ms > bestMs) {
      best = row
      bestMs = ms
    }
  }
  return best
}

export interface PrecallMessage {
  direction: 'inbound' | 'outbound'
  body: string | null
  /** ISO timestamp the message was sent. */
  sentAt: string
}

export interface LeadPromiseInput {
  messages: readonly PrecallMessage[]
  /** Non-Messenger touchpoints of this contact (same shape the lead follow-up list uses). */
  touches: readonly LeadTouch[]
  now: Date
  holidays: ReadonlySet<string>
  /** True when the contact is marked do-not-contact: never flag overdue. */
  doNotContact: boolean
}

export interface LeadPromiseStatus {
  /** False when no form submission was found; all other fields are then null/false. */
  isFormLead: boolean
  formSubmittedAt: string | null
  /** End of the first NZ business day after submission (ISO). */
  dueAt: string | null
  /** Past due AND no human touch since submission AND not do-not-contact. */
  overdue: boolean
  /** Guest wrote at least one real message after the form opening line. null when not a form lead. */
  guestReplied: boolean | null
}

/**
 * When the lead form was submitted: the latest of the inbound form-opening
 * messages and the `meta_lead_form` touchpoints. Invalid timestamps are ignored.
 */
export function pickFormSubmittedAt(
  messages: readonly PrecallMessage[],
  touches: readonly LeadTouch[],
): Date | null {
  let latest: number | null = null

  for (const message of messages) {
    if (message.direction !== 'inbound') continue
    const body = message.body?.trim() ?? ''
    if (!isFormIntroBody(body)) continue
    const ms = parseTimestamp(message.sentAt)
    if (ms === null) continue
    if (latest === null || ms > latest) latest = ms
  }

  for (const touch of touches) {
    if (touch.channel !== 'meta_lead_form') continue
    const ms = parseTimestamp(touch.occurredAt)
    if (ms === null) continue
    if (latest === null || ms > latest) latest = ms
  }

  return latest === null ? null : new Date(latest)
}

/**
 * True when the guest wrote a real message after the form opening line.
 * Outbound messages never count — "we messaged them" is not a reply.
 */
export function hasGuestReplied(messages: readonly PrecallMessage[], formAt: Date): boolean {
  const formMs = formAt.getTime()
  for (const message of messages) {
    if (message.direction !== 'inbound') continue
    const body = message.body?.trim() ?? ''
    if (body.length === 0) continue
    if (isFormIntroBody(body)) continue
    const ms = parseTimestamp(message.sentAt)
    if (ms === null || ms <= formMs) continue
    return true
  }
  return false
}

/**
 * Assess the "reply within 1 business day" promise for a lead-form submission.
 *
 * Overdue means: past the promise due instant, no human follow-up since the
 * form, and the contact is not marked do-not-contact.
 */
export function assessLeadPromise(input: LeadPromiseInput): LeadPromiseStatus {
  const formAt = pickFormSubmittedAt(input.messages, input.touches)
  if (formAt === null) {
    return {
      isFormLead: false,
      formSubmittedAt: null,
      dueAt: null,
      overdue: false,
      guestReplied: null,
    }
  }

  const formMs = formAt.getTime()
  const humanTouched = input.touches.some((touch) => {
    const ms = parseTimestamp(touch.occurredAt)
    if (ms === null || ms <= formMs) return false
    return isHumanFollowup(touch)
  })

  const overdue =
    !input.doNotContact &&
    !humanTouched &&
    isPastPromiseDue(formAt, input.now, input.holidays)

  return {
    isFormLead: true,
    formSubmittedAt: formAt.toISOString(),
    dueAt: leadPromiseDueAt(formAt, input.holidays).toISOString(),
    overdue,
    guestReplied: hasGuestReplied(input.messages, formAt),
  }
}
