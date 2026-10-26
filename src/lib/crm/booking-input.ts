/**
 * Pure request-body parsers for the CRM booking tracker routes.
 *
 * No I/O, no Next imports, no supabase client. Every function is a pure
 * transformation from an untrusted JSON body to a typed value or a plain
 * error string. The route handlers own the HTTP status mapping.
 *
 * Security contract:
 * - findForbiddenField rejects any body that tries to smuggle a field the
 *   staff routes must never accept (paid source, actor, client id, ...).
 * - expectedUpdatedAt is passed through byte-for-byte so the optimistic
 *   concurrency check in SQL compares the exact value the client saw.
 */

import type { MilestoneKind, NudgeMode } from './booking-types'
import type { CreateBookingInput } from './booking-store'
import { isUuid } from '../validation-utils'
import { isIsoDate } from '../locale/nz-public-holidays'

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string }

// ─── Forbidden body fields ────────────────────────────────────────────────────

/**
 * Field names a staff request body must never carry. Declared with their
 * original spelling; the normalised set below also catches camelCase and
 * `p_`-prefixed variants.
 */
export const FORBIDDEN_BODY_FIELDS = [
  'paid_source',
  'source',
  'actor',
  'actor_email',
  'p_server_detector',
  'client_id',
  'paid_evidence_ref',
] as const

/** lower-case, strip one leading `p_`, then delete every `_` and `-`. */
function normaliseFieldName(key: string): string {
  let name = key.toLowerCase()
  if (name.startsWith('p_')) name = name.slice(2)
  return name.replace(/[_-]/g, '')
}

const FORBIDDEN_NORMALISED: ReadonlySet<string> = new Set(
  FORBIDDEN_BODY_FIELDS.map(normaliseFieldName),
)

const MAX_FORBIDDEN_DEPTH = 6

/**
 * Walks objects and arrays recursively and returns the first offending key
 * name as written, or null when the body is clean. Only keys are inspected,
 * never string values. Nesting deeper than MAX_FORBIDDEN_DEPTH yields the
 * sentinel key 'too_deep'.
 */
export function findForbiddenField(value: unknown): string | null {
  return walkForbidden(value, 0)
}

function walkForbidden(value: unknown, depth: number): string | null {
  if (depth > MAX_FORBIDDEN_DEPTH) return 'too_deep'
  if (Array.isArray(value)) {
    for (const item of value) {
      const hit = walkForbidden(item, depth + 1)
      if (hit !== null) return hit
    }
    return null
  }
  if (typeof value !== 'object' || value === null) return null
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_NORMALISED.has(normaliseFieldName(key))) return key
    const hit = walkForbidden(child, depth + 1)
    if (hit !== null) return hit
  }
  return null
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

/** Rejects any top-level key not in `allowed`. Returns the error or null. */
function rejectUnknownKeys(body: Record<string, unknown>, allowed: readonly string[]): string | null {
  const allowedSet = new Set(allowed)
  for (const key of Object.keys(body)) {
    if (!allowedSet.has(key)) return `unknown_field:${key}`
  }
  return null
}

const MAX_EXPECTED_UPDATED_AT = 64

const ISO_8601_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/

/**
 * Reads the required optimistic-concurrency token. The original string is
 * returned unchanged; it is never reformatted.
 */
function readExpectedUpdatedAt(body: Record<string, unknown>): ParseResult<string> {
  const raw = body.expectedUpdatedAt
  if (typeof raw !== 'string') return { ok: false, error: 'invalid_expected_updated_at' }
  if (raw.length === 0 || raw.length > MAX_EXPECTED_UPDATED_AT) {
    return { ok: false, error: 'invalid_expected_updated_at' }
  }
  if (!ISO_8601_RE.test(raw)) return { ok: false, error: 'invalid_expected_updated_at' }
  if (Number.isNaN(Date.parse(raw))) return { ok: false, error: 'invalid_expected_updated_at' }
  return { ok: true, value: raw }
}

// ─── Small value parsers ──────────────────────────────────────────────────────

/** Only 'deposit' | 'balance'. */
export function parseKind(raw: unknown): MilestoneKind | null {
  return raw === 'deposit' || raw === 'balance' ? raw : null
}

/** /^\d{1,4}$/ -> Number, else null. */
export function parseLimitParam(raw: string | null): number | null {
  if (raw === null || !/^\d{1,4}$/.test(raw)) return null
  return Number(raw)
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * True when `text` contains any control character U+0000-U+001F or U+007F.
 * When `allowTabNewline` is true, tab (U+0009) and newline (U+000A) are
 * permitted and do not count as control characters.
 */
function hasControlChars(text: string, allowTabNewline: boolean): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (allowTabNewline && (code === 0x09 || code === 0x0a)) continue
    if (code <= 0x1f || code === 0x7f) return true
  }
  return false
}

/** Trim + lower-case, length 3..200, must look like an email; else null. */
export function normaliseBookingMemberEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  if (hasControlChars(raw, false)) return null
  const email = raw.trim().toLowerCase()
  if (email.length < 3 || email.length > 200) return null
  return EMAIL_RE.test(email) ? email : null
}

// ─── Field-level validators ───────────────────────────────────────────────────

const MAX_NOTE = 500

/** uuid or null; `allowNull` controls whether null is accepted. */
function readUuid(raw: unknown, allowNull: boolean): string | null | undefined {
  if (raw === null || raw === undefined) return allowNull ? null : undefined
  return isUuid(raw) ? raw : undefined
}

/** ISO date or null; `allowNull` controls whether null is accepted. */
function readIsoDate(raw: unknown, allowNull: boolean): string | null | undefined {
  if (raw === null || raw === undefined) return allowNull ? null : undefined
  return typeof raw === 'string' && isIsoDate(raw) ? raw : undefined
}

/** Integer 1..60 or null. */
function readPartySize(raw: unknown): number | null | undefined {
  if (raw === null || raw === undefined) return null
  if (typeof raw !== 'number' || !Number.isInteger(raw)) return undefined
  return raw >= 1 && raw <= 60 ? raw : undefined
}

/** Trimmed string, empty -> null, max 500 chars. */
function readNote(raw: unknown): string | null | undefined {
  if (raw === null || raw === undefined) return null
  if (typeof raw !== 'string') return undefined
  if (hasControlChars(raw, true)) return undefined
  const note = raw.trim()
  if (note.length === 0) return null
  return note.length <= MAX_NOTE ? note : undefined
}

// ─── Create ───────────────────────────────────────────────────────────────────

const CREATE_KEYS = [
  'contactId',
  'tourId',
  'departureId',
  'bookedOn',
  'partySize',
  'isCruise',
  'note',
] as const

export function parseCreateBody(body: Record<string, unknown>): ParseResult<CreateBookingInput> {
  const unknown = rejectUnknownKeys(body, CREATE_KEYS)
  if (unknown !== null) return { ok: false, error: unknown }

  if (!isUuid(body.contactId)) return { ok: false, error: 'invalid_contact_id' }
  if (!isUuid(body.tourId)) return { ok: false, error: 'invalid_tour_id' }

  const departureId = readUuid(body.departureId, true)
  if (departureId === undefined) return { ok: false, error: 'invalid_departure_id' }

  const bookedOn = readIsoDate(body.bookedOn, true)
  if (bookedOn === undefined) return { ok: false, error: 'invalid_booked_on' }

  const partySize = readPartySize(body.partySize)
  if (partySize === undefined) return { ok: false, error: 'invalid_party_size' }

  const isCruise = body.isCruise === undefined ? false : body.isCruise
  if (typeof isCruise !== 'boolean') return { ok: false, error: 'invalid_is_cruise' }

  const note = readNote(body.note)
  if (note === undefined) return { ok: false, error: 'invalid_note' }

  return {
    ok: true,
    value: {
      contactId: body.contactId,
      tourId: body.tourId,
      departureId,
      bookedOn,
      partySize,
      isCruise,
      note,
    },
  }
}

// ─── Patch ────────────────────────────────────────────────────────────────────

const PATCH_KEYS = ['expectedUpdatedAt', 'patch'] as const
const PATCH_FIELD_KEYS = ['tourId', 'departureId', 'bookedOn', 'partySize', 'isCruise', 'note'] as const

export function parsePatchBody(
  body: Record<string, unknown>,
): ParseResult<{ expectedUpdatedAt: string; patch: Record<string, unknown> }> {
  const unknown = rejectUnknownKeys(body, PATCH_KEYS)
  if (unknown !== null) return { ok: false, error: unknown }

  const expected = readExpectedUpdatedAt(body)
  if (!expected.ok) return expected

  const rawPatch = body.patch
  if (typeof rawPatch !== 'object' || rawPatch === null || Array.isArray(rawPatch)) {
    return { ok: false, error: 'empty_patch' }
  }
  const source = rawPatch as Record<string, unknown>
  if (Object.keys(source).length === 0) return { ok: false, error: 'empty_patch' }

  const patch: Record<string, unknown> = {}
  for (const key of Object.keys(source)) {
    const parsed = parsePatchField(key, source[key])
    if (typeof parsed === 'string') return { ok: false, error: parsed }
    patch[parsed.dbKey] = parsed.value
  }

  return { ok: true, value: { expectedUpdatedAt: expected.value, patch } }
}

type PatchFieldResult = { dbKey: string; value: unknown }

/** Validates one patch field and maps it to its database column name. */
function parsePatchField(key: string, raw: unknown): PatchFieldResult | string {
  switch (key) {
    case 'tourId': {
      const value = readUuid(raw, false)
      return value === undefined ? 'invalid_tour_id' : { dbKey: 'tour_id', value }
    }
    case 'departureId': {
      const value = readUuid(raw, true)
      return value === undefined ? 'invalid_departure_id' : { dbKey: 'departure_id', value }
    }
    case 'bookedOn': {
      const value = readIsoDate(raw, false)
      return value === undefined ? 'invalid_booked_on' : { dbKey: 'booked_on', value }
    }
    case 'partySize': {
      const value = readPartySize(raw)
      return value === undefined ? 'invalid_party_size' : { dbKey: 'party_size', value }
    }
    case 'isCruise': {
      if (typeof raw !== 'boolean') return 'invalid_is_cruise'
      return { dbKey: 'is_cruise', value: raw }
    }
    case 'note': {
      const value = readNote(raw)
      return value === undefined ? 'invalid_note' : { dbKey: 'note', value }
    }
    default:
      return `unknown_field:${key}`
  }
}

// ─── Paid / expected-only / override ──────────────────────────────────────────

const PAID_KEYS = ['expectedUpdatedAt', 'paidOn'] as const

export function parsePaidBody(
  body: Record<string, unknown>,
  today?: string,
): ParseResult<{ expectedUpdatedAt: string; paidOn: string | null }> {
  const unknown = rejectUnknownKeys(body, PAID_KEYS)
  if (unknown !== null) return { ok: false, error: unknown }

  const expected = readExpectedUpdatedAt(body)
  if (!expected.ok) return expected

  const paidOn = readIsoDate(body.paidOn, true)
  if (paidOn === undefined) return { ok: false, error: 'invalid_paid_on' }
  // A payment cannot have been received after today (NZ date, passed in by the route).
  if (today !== undefined && paidOn !== null && paidOn > today) {
    return { ok: false, error: 'invalid_paid_on' }
  }

  return { ok: true, value: { expectedUpdatedAt: expected.value, paidOn } }
}

const EXPECTED_ONLY_KEYS = ['expectedUpdatedAt'] as const

export function parseExpectedOnly(
  body: Record<string, unknown>,
): ParseResult<{ expectedUpdatedAt: string }> {
  const unknown = rejectUnknownKeys(body, EXPECTED_ONLY_KEYS)
  if (unknown !== null) return { ok: false, error: unknown }

  const expected = readExpectedUpdatedAt(body)
  if (!expected.ok) return expected

  return { ok: true, value: { expectedUpdatedAt: expected.value } }
}

const OVERRIDE_KEYS = ['expectedUpdatedAt', 'dueOn'] as const

export function parseOverrideBody(
  body: Record<string, unknown>,
): ParseResult<{ expectedUpdatedAt: string; dueOn: string | null }> {
  const unknown = rejectUnknownKeys(body, OVERRIDE_KEYS)
  if (unknown !== null) return { ok: false, error: unknown }

  const expected = readExpectedUpdatedAt(body)
  if (!expected.ok) return expected

  // `dueOn` must be present: an ISO date to set, or explicit null to clear.
  if (!('dueOn' in body)) return { ok: false, error: 'invalid_due_on' }
  const dueOn = readIsoDate(body.dueOn, true)
  if (dueOn === undefined) return { ok: false, error: 'invalid_due_on' }

  return { ok: true, value: { expectedUpdatedAt: expected.value, dueOn } }
}

// ─── Nudge ────────────────────────────────────────────────────────────────────

const NUDGE_KEYS = ['expectedUpdatedAt', 'mode', 'days'] as const
const SNOOZE_DAYS: readonly number[] = [3, 7, 14]

export function parseNudgeBody(
  body: Record<string, unknown>,
): ParseResult<{ expectedUpdatedAt: string; mode: NudgeMode; days: number | null }> {
  const unknown = rejectUnknownKeys(body, NUDGE_KEYS)
  if (unknown !== null) return { ok: false, error: unknown }

  const expected = readExpectedUpdatedAt(body)
  if (!expected.ok) return expected

  const mode = body.mode
  if (mode !== 'nudged_today' && mode !== 'snooze' && mode !== 'quiet') {
    return { ok: false, error: 'invalid_mode' }
  }

  if (mode === 'snooze') {
    const days = body.days
    if (typeof days !== 'number' || !SNOOZE_DAYS.includes(days)) {
      return { ok: false, error: 'invalid_days' }
    }
    return { ok: true, value: { expectedUpdatedAt: expected.value, mode, days } }
  }

  if (body.days !== undefined && body.days !== null) {
    return { ok: false, error: 'invalid_days' }
  }
  return { ok: true, value: { expectedUpdatedAt: expected.value, mode, days: null } }
}

// ─── Cancel ───────────────────────────────────────────────────────────────────

const CANCEL_KEYS = ['expectedUpdatedAt', 'cancelNote'] as const
const MAX_CANCEL_NOTE = 200

export function parseCancelBody(
  body: Record<string, unknown>,
): ParseResult<{ expectedUpdatedAt: string; cancelNote: string }> {
  const unknown = rejectUnknownKeys(body, CANCEL_KEYS)
  if (unknown !== null) return { ok: false, error: unknown }

  const expected = readExpectedUpdatedAt(body)
  if (!expected.ok) return expected

  const raw = body.cancelNote
  if (typeof raw !== 'string') return { ok: false, error: 'invalid_cancel_note' }
  if (hasControlChars(raw, true)) return { ok: false, error: 'invalid_cancel_note' }
  const cancelNote = raw.trim()
  if (cancelNote.length < 1 || cancelNote.length > MAX_CANCEL_NOTE) {
    return { ok: false, error: 'invalid_cancel_note' }
  }

  return { ok: true, value: { expectedUpdatedAt: expected.value, cancelNote } }
}
