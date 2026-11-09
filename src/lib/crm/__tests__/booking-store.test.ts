/**
 * Tests for the CRM booking store wrappers.
 *
 * The store is a thin layer over the SQL rpc functions, so these tests assert
 * on the exact rpc name and argument object each wrapper sends, plus the
 * mapping of SQL error strings to typed StoreResult failures.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  cancelBooking,
  confirmDeparture,
  createBooking,
  mapRpcError,
  nudgeMilestone,
  overrideDue,
  setPaid,
  unsetPaid,
  updateBooking,
} from '../booking-store'
import { createFakeDb, type FakeState } from './booking-fake-db'
import { BOOKING_A1, CLIENT_A, CONTACT_A1, DEP_A1, TOUR_A1, UPDATED_AT } from './booking-fixtures'

let db: SupabaseClient
let state: FakeState

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const fake = createFakeDb()
  db = fake.db
  state = fake.state
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('mapRpcError', () => {
  it.each([
    ['conflict:stale:abc', 'stale'],
    ['duplicate_booking', 'duplicate'],
    ['booking_not_active', 'inactive'],
    ['evidence_required', 'forbidden'],
    ['evidence_only_for_email', 'forbidden'],
    ['email_source_requires_server_detector', 'forbidden'],
    ['cross_client_reference:tour_id', 'forbidden'],
    ['invalid_actor', 'invalid'],
    ['invalid_kind', 'invalid'],
    ['invalid_patch:note', 'invalid'],
    ['invalid_null:tour_id', 'invalid'],
    ['invalid_mode', 'invalid'],
    ['invalid_days', 'invalid'],
    ['invalid_cancel_note', 'invalid'],
    ['invalid_paid_source', 'invalid'],
    ['field_not_editable:client_id', 'invalid'],
    ['not_paid', 'invalid'],
    ['contact_not_found', 'not_found'],
    ['tour_not_found', 'not_found'],
    ['departure_not_found', 'not_found'],
    ['booking_not_found', 'not_found'],
    ['milestone_not_found', 'not_found'],
  ] as const)('maps %s to kind %s', (message, kind) => {
    const result = mapRpcError(message)
    expect(result.kind).toBe(kind)
    expect(result.code).toBe(message)
  })

  it('maps an unknown message to error/unknown without leaking the message', () => {
    const result = mapRpcError('something strange')
    expect(result.kind).toBe('error')
    expect(result.code).toBe('unknown')
    expect(result.code).not.toContain('something strange')
  })

  it.each(['22007', '22008', '22P02'] as const)(
    'maps sqlState %s to invalid/invalid_input',
    (sqlState) => {
      const result = mapRpcError('anything', sqlState)
      expect(result).toEqual({ kind: 'invalid', code: 'invalid_input' })
    },
  )

  it('maps an invalid input syntax message to invalid/invalid_input without echoing it', () => {
    const result = mapRpcError('invalid input syntax for type uuid: "zzz"')
    expect(result).toEqual({ kind: 'invalid', code: 'invalid_input' })
    expect(result.code).not.toContain('zzz')
  })

  it('leaves an unknown message with an unrelated sqlState as error/unknown', () => {
    const result = mapRpcError('something strange', '23505')
    expect(result).toEqual({ kind: 'error', code: 'unknown' })
  })
})

describe('createBooking', () => {
  it('calls crm_booking_create with the exact argument object', async () => {
    state.rpcData['crm_booking_create'] = { id: BOOKING_A1 }
    const result = await createBooking(
      db,
      CLIENT_A,
      {
        contactId: CONTACT_A1,
        tourId: TOUR_A1,
        departureId: DEP_A1,
        bookedOn: '2026-10-12',
        partySize: 2,
        isCruise: true,
        note: 'Li couple',
      },
      'staff@a.test',
    )
    expect(state.rpcCalls[0]).toEqual({
      name: 'crm_booking_create',
      args: {
        p_client_id: CLIENT_A,
        p_contact_id: CONTACT_A1,
        p_tour_id: TOUR_A1,
        p_departure_id: DEP_A1,
        p_booked_on: '2026-10-12',
        p_party_size: 2,
        p_is_cruise: true,
        p_note: 'Li couple',
        p_actor: 'staff@a.test',
      },
    })
    expect(result).toEqual({ ok: true, value: { id: BOOKING_A1 } })
  })

  it('sends null for absent optional values', async () => {
    state.rpcData['crm_booking_create'] = { id: BOOKING_A1 }
    await createBooking(
      db,
      CLIENT_A,
      {
        contactId: CONTACT_A1,
        tourId: TOUR_A1,
        departureId: null,
        bookedOn: null,
        partySize: null,
        isCruise: false,
        note: null,
      },
      'staff@a.test',
    )
    expect(state.rpcCalls[0].args).toEqual({
      p_client_id: CLIENT_A,
      p_contact_id: CONTACT_A1,
      p_tour_id: TOUR_A1,
      p_departure_id: null,
      p_booked_on: null,
      p_party_size: null,
      p_is_cruise: false,
      p_note: null,
      p_actor: 'staff@a.test',
    })
  })

  it('returns an error result when the rpc data has no id', async () => {
    state.rpcData['crm_booking_create'] = {}
    const result = await createBooking(
      db,
      CLIENT_A,
      {
        contactId: CONTACT_A1,
        tourId: TOUR_A1,
        departureId: null,
        bookedOn: null,
        partySize: null,
        isCruise: false,
        note: null,
      },
      'staff@a.test',
    )
    expect(result).toEqual({ ok: false, kind: 'error', code: 'unknown' })
  })
})

describe('updateBooking', () => {
  it('calls crm_booking_update with the exact argument object', async () => {
    await updateBooking(
      db,
      CLIENT_A,
      BOOKING_A1,
      UPDATED_AT,
      { note: 'x' },
      'staff@a.test',
    )
    expect(state.rpcCalls[0]).toEqual({
      name: 'crm_booking_update',
      args: {
        p_client_id: CLIENT_A,
        p_booking_id: BOOKING_A1,
        p_expected_updated_at: UPDATED_AT,
        p_patch: { note: 'x' },
        p_actor: 'staff@a.test',
      },
    })
  })
})

describe('unsetPaid', () => {
  it('calls crm_booking_unset_paid with the exact argument object', async () => {
    await unsetPaid(db, CLIENT_A, BOOKING_A1, 'deposit', UPDATED_AT, 'staff@a.test')
    expect(state.rpcCalls[0]).toEqual({
      name: 'crm_booking_unset_paid',
      args: {
        p_client_id: CLIENT_A,
        p_booking_id: BOOKING_A1,
        p_kind: 'deposit',
        p_expected_updated_at: UPDATED_AT,
        p_actor: 'staff@a.test',
      },
    })
  })
})

describe('overrideDue', () => {
  it('calls crm_booking_override_due with the exact argument object', async () => {
    await overrideDue(db, CLIENT_A, BOOKING_A1, 'balance', UPDATED_AT, '2026-12-20', 'staff@a.test')
    expect(state.rpcCalls[0]).toEqual({
      name: 'crm_booking_override_due',
      args: {
        p_client_id: CLIENT_A,
        p_booking_id: BOOKING_A1,
        p_kind: 'balance',
        p_expected_updated_at: UPDATED_AT,
        p_due_override_on: '2026-12-20',
        p_actor: 'staff@a.test',
      },
    })
  })
})

describe('confirmDeparture', () => {
  it('calls crm_booking_confirm_departure with the exact argument object', async () => {
    await confirmDeparture(db, CLIENT_A, BOOKING_A1, UPDATED_AT, 'staff@a.test')
    expect(state.rpcCalls[0]).toEqual({
      name: 'crm_booking_confirm_departure',
      args: {
        p_client_id: CLIENT_A,
        p_booking_id: BOOKING_A1,
        p_expected_updated_at: UPDATED_AT,
        p_actor: 'staff@a.test',
      },
    })
  })
})

describe('nudgeMilestone', () => {
  it('calls crm_booking_nudge with the exact argument object', async () => {
    await nudgeMilestone(db, CLIENT_A, BOOKING_A1, 'deposit', UPDATED_AT, 'snooze', 7, 'staff@a.test')
    expect(state.rpcCalls[0]).toEqual({
      name: 'crm_booking_nudge',
      args: {
        p_client_id: CLIENT_A,
        p_booking_id: BOOKING_A1,
        p_kind: 'deposit',
        p_expected_updated_at: UPDATED_AT,
        p_mode: 'snooze',
        p_days: 7,
        p_actor: 'staff@a.test',
      },
    })
  })
})

describe('cancelBooking', () => {
  it('calls crm_booking_cancel with the exact argument object', async () => {
    await cancelBooking(db, CLIENT_A, BOOKING_A1, UPDATED_AT, 'gone', 'staff@a.test')
    expect(state.rpcCalls[0]).toEqual({
      name: 'crm_booking_cancel',
      args: {
        p_client_id: CLIENT_A,
        p_booking_id: BOOKING_A1,
        p_expected_updated_at: UPDATED_AT,
        p_cancel_note: 'gone',
        p_actor: 'staff@a.test',
      },
    })
  })
})

describe('setPaid security contract', () => {
  it('has no parameter for source, evidence or detector', () => {
    expect(setPaid.length).toBe(7)
  })

  it('always sends staff source, null evidence and detector false', async () => {
    await setPaid(db, CLIENT_A, BOOKING_A1, 'deposit', UPDATED_AT, '2026-10-08', 'staff@a.test')
    expect(state.rpcCalls[0]).toEqual({
      name: 'crm_booking_set_paid',
      args: {
        p_client_id: CLIENT_A,
        p_booking_id: BOOKING_A1,
        p_kind: 'deposit',
        p_expected_updated_at: UPDATED_AT,
        p_paid_on: '2026-10-08',
        p_paid_source: 'staff',
        p_evidence_ref: null,
        p_server_detector: false,
        p_actor: 'staff@a.test',
      },
    })
  })

  it('maps a changed result', async () => {
    state.rpcData['crm_booking_set_paid'] = { changed: true, reason: null }
    const result = await setPaid(db, CLIENT_A, BOOKING_A1, 'deposit', UPDATED_AT, null, 'staff@a.test')
    expect(result).toEqual({ ok: true, value: { changed: true, reason: null } })
  })

  it('maps an unchanged result with a reason', async () => {
    state.rpcData['crm_booking_set_paid'] = { changed: false, reason: 'already_paid' }
    const result = await setPaid(db, CLIENT_A, BOOKING_A1, 'deposit', UPDATED_AT, null, 'staff@a.test')
    expect(result).toEqual({ ok: true, value: { changed: false, reason: 'already_paid' } })
  })

  it('maps a malformed payload to changed false, reason null', async () => {
    state.rpcData['crm_booking_set_paid'] = { changed: 'yes', reason: 42 }
    const result = await setPaid(db, CLIENT_A, BOOKING_A1, 'deposit', UPDATED_AT, null, 'staff@a.test')
    expect(result).toEqual({ ok: true, value: { changed: false, reason: null } })
  })
})

describe('error mapping end to end', () => {
  it.each([
    ['conflict:stale:x', 'stale'],
    ['booking_not_found', 'not_found'],
    ['invalid_patch:note', 'invalid'],
    ['evidence_required', 'forbidden'],
    ['duplicate_booking', 'duplicate'],
    ['booking_not_active', 'inactive'],
  ] as const)('maps %s to kind %s', async (message, kind) => {
    state.rpcErrors['crm_booking_update'] = message
    const result = await updateBooking(db, CLIENT_A, BOOKING_A1, UPDATED_AT, { note: 'x' }, 'staff@a.test')
    expect(result).toEqual({ ok: false, kind, code: message })
  })
})

describe('thrown rpc errors', () => {
  it('returns error/unknown and does not throw', async () => {
    vi.spyOn(db, 'rpc').mockImplementation(() => {
      throw new Error('network down')
    })
    const result = await updateBooking(db, CLIENT_A, BOOKING_A1, UPDATED_AT, { note: 'x' }, 'staff@a.test')
    expect(result).toEqual({ ok: false, kind: 'error', code: 'unknown' })
  })
})

describe('cast error mapping end to end', () => {
  it('maps a 22007 cast error to invalid/invalid_input', async () => {
    vi.spyOn(db, 'rpc').mockImplementation(() =>
      Promise.resolve({
        data: null,
        error: { message: 'invalid input syntax for type date: "x"', code: '22007' },
      }) as never,
    )
    const result = await updateBooking(db, CLIENT_A, BOOKING_A1, UPDATED_AT, { note: 'x' }, 'staff@a.test')
    expect(result).toEqual({ ok: false, kind: 'invalid', code: 'invalid_input' })
  })
})
