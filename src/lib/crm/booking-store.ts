/**
 * Thin typed wrappers around the CRM booking tracker SQL functions.
 *
 * The Supabase client is always passed in by the caller; this module never
 * imports a client. Every wrapper sends all of the SQL function's parameters
 * (null for absent values, never undefined) and maps SQL error strings to the
 * typed StoreResult shape from './booking-types'.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { MilestoneKind, NudgeMode, StoreErrorKind, StoreResult } from './booking-types'

/** Postgres SQLSTATEs for date/time and invalid-text-representation cast errors. */
const CAST_ERROR_SQL_STATES: ReadonlySet<string> = new Set(['22007', '22008', '22P02'])

/** Maps a raw SQL error message to a typed error kind and code. */
export function mapRpcError(message: string, sqlState?: string): { kind: StoreErrorKind; code: string } {
  if (
    (sqlState !== undefined && CAST_ERROR_SQL_STATES.has(sqlState)) ||
    message.startsWith('invalid input syntax')
  ) {
    return { kind: 'invalid', code: 'invalid_input' }
  }
  if (message.startsWith('conflict:stale:')) {
    return { kind: 'stale', code: message }
  }
  if (message === 'duplicate_booking') {
    return { kind: 'duplicate', code: message }
  }
  if (message === 'booking_not_active') {
    return { kind: 'inactive', code: message }
  }
  if (
    message.startsWith('evidence_') ||
    message === 'email_source_requires_server_detector' ||
    message.startsWith('cross_client_reference:')
  ) {
    return { kind: 'forbidden', code: message }
  }
  if (
    message.startsWith('invalid_') ||
    message.startsWith('field_not_editable:') ||
    message === 'not_paid'
  ) {
    return { kind: 'invalid', code: message }
  }
  if (message.endsWith('_not_found')) {
    return { kind: 'not_found', code: message }
  }
  console.error('[crm booking store] unexpected rpc error:', message)
  return { kind: 'error', code: 'unknown' }
}

type RpcArgs = Record<string, unknown>

type CallResult =
  | { ok: true; data: unknown }
  | { ok: false; kind: StoreErrorKind; code: string }

/** Runs an rpc call, mapping thrown errors and res.error to typed failures. */
async function callRpc(db: SupabaseClient, fn: string, args: RpcArgs): Promise<CallResult> {
  try {
    const res = await db.rpc(fn, args)
    if (res.error) {
      const sqlState = typeof res.error.code === 'string' ? res.error.code : undefined
      return { ok: false, ...mapRpcError(res.error.message, sqlState) }
    }
    return { ok: true, data: res.data }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[crm booking store] unexpected rpc error:', message)
    return { ok: false, kind: 'error', code: 'unknown' }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readId(data: unknown): string | null {
  if (!isRecord(data)) return null
  const id = data.id
  return typeof id === 'string' && id.length > 0 ? id : null
}

function readPaidResult(data: unknown): { changed: boolean; reason: string | null } {
  if (!isRecord(data)) return { changed: false, reason: null }
  const changed = typeof data.changed === 'boolean' ? data.changed : false
  const reason = typeof data.reason === 'string' ? data.reason : null
  return { changed, reason }
}

export interface CreateBookingInput {
  contactId: string
  tourId: string
  departureId: string | null
  bookedOn: string | null
  partySize: number | null
  isCruise: boolean
  note: string | null
}

export async function createBooking(
  db: SupabaseClient,
  clientId: string,
  input: CreateBookingInput,
  actor: string,
): Promise<StoreResult<{ id: string }>> {
  const res = await callRpc(db, 'crm_booking_create', {
    p_client_id: clientId,
    p_contact_id: input.contactId,
    p_tour_id: input.tourId,
    p_departure_id: input.departureId,
    p_booked_on: input.bookedOn,
    p_party_size: input.partySize,
    p_is_cruise: input.isCruise,
    p_note: input.note,
    p_actor: actor,
  })
  if (!res.ok) return res
  const id = readId(res.data)
  if (id === null) {
    console.error('[crm booking store] unexpected rpc error:', 'create_booking_missing_id')
    return { ok: false, kind: 'error', code: 'unknown' }
  }
  return { ok: true, value: { id } }
}

export async function updateBooking(
  db: SupabaseClient,
  clientId: string,
  bookingId: string,
  expectedUpdatedAt: string,
  patch: Record<string, unknown>,
  actor: string,
): Promise<StoreResult<null>> {
  const res = await callRpc(db, 'crm_booking_update', {
    p_client_id: clientId,
    p_booking_id: bookingId,
    p_expected_updated_at: expectedUpdatedAt,
    p_patch: patch,
    p_actor: actor,
  })
  if (!res.ok) return res
  return { ok: true, value: null }
}

/**
 * Marks a milestone paid as a staff action.
 *
 * There is deliberately no parameter for the paid source, the evidence
 * reference or the detector flag: the 'email' source may only ever be written
 * by the server-side email detector, never by a staff route.
 */
export async function setPaid(
  db: SupabaseClient,
  clientId: string,
  bookingId: string,
  kind: MilestoneKind,
  expectedUpdatedAt: string,
  paidOn: string | null,
  actor: string,
): Promise<StoreResult<{ changed: boolean; reason: string | null }>> {
  const res = await callRpc(db, 'crm_booking_set_paid', {
    p_client_id: clientId,
    p_booking_id: bookingId,
    p_kind: kind,
    p_expected_updated_at: expectedUpdatedAt,
    p_paid_on: paidOn,
    p_paid_source: 'staff',
    p_evidence_ref: null,
    p_server_detector: false,
    p_actor: actor,
  })
  if (!res.ok) return res
  return { ok: true, value: readPaidResult(res.data) }
}

export async function unsetPaid(
  db: SupabaseClient,
  clientId: string,
  bookingId: string,
  kind: MilestoneKind,
  expectedUpdatedAt: string,
  actor: string,
): Promise<StoreResult<null>> {
  const res = await callRpc(db, 'crm_booking_unset_paid', {
    p_client_id: clientId,
    p_booking_id: bookingId,
    p_kind: kind,
    p_expected_updated_at: expectedUpdatedAt,
    p_actor: actor,
  })
  if (!res.ok) return res
  return { ok: true, value: null }
}

export async function overrideDue(
  db: SupabaseClient,
  clientId: string,
  bookingId: string,
  kind: MilestoneKind,
  expectedUpdatedAt: string,
  dueOn: string | null,
  actor: string,
): Promise<StoreResult<null>> {
  const res = await callRpc(db, 'crm_booking_override_due', {
    p_client_id: clientId,
    p_booking_id: bookingId,
    p_kind: kind,
    p_expected_updated_at: expectedUpdatedAt,
    p_due_override_on: dueOn,
    p_actor: actor,
  })
  if (!res.ok) return res
  return { ok: true, value: null }
}

export async function confirmDeparture(
  db: SupabaseClient,
  clientId: string,
  bookingId: string,
  expectedUpdatedAt: string,
  actor: string,
): Promise<StoreResult<null>> {
  const res = await callRpc(db, 'crm_booking_confirm_departure', {
    p_client_id: clientId,
    p_booking_id: bookingId,
    p_expected_updated_at: expectedUpdatedAt,
    p_actor: actor,
  })
  if (!res.ok) return res
  return { ok: true, value: null }
}

export async function nudgeMilestone(
  db: SupabaseClient,
  clientId: string,
  bookingId: string,
  kind: MilestoneKind,
  expectedUpdatedAt: string,
  mode: NudgeMode,
  days: number | null,
  actor: string,
): Promise<StoreResult<null>> {
  const res = await callRpc(db, 'crm_booking_nudge', {
    p_client_id: clientId,
    p_booking_id: bookingId,
    p_kind: kind,
    p_expected_updated_at: expectedUpdatedAt,
    p_mode: mode,
    p_days: days,
    p_actor: actor,
  })
  if (!res.ok) return res
  return { ok: true, value: null }
}

export async function cancelBooking(
  db: SupabaseClient,
  clientId: string,
  bookingId: string,
  expectedUpdatedAt: string,
  cancelNote: string,
  actor: string,
): Promise<StoreResult<null>> {
  const res = await callRpc(db, 'crm_booking_cancel', {
    p_client_id: clientId,
    p_booking_id: bookingId,
    p_expected_updated_at: expectedUpdatedAt,
    p_cancel_note: cancelNote,
    p_actor: actor,
  })
  if (!res.ok) return res
  return { ok: true, value: null }
}
