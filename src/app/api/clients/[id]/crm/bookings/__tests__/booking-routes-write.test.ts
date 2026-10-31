import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'
import type { FakeState } from '@/lib/crm/__tests__/booking-fake-db'
import {
  CLIENT_A,
  CLIENT_B,
  CONTACT_A1,
  CONTACT_B1,
  TOUR_A1,
  TOUR_B1,
  DEP_A1,
  BOOKING_A1,
  BOOKING_B1,
  UPDATED_AT,
  ENABLED_LEADS_CONFIG,
  TOURS_TABLE,
} from '@/lib/crm/__tests__/booking-fixtures'
import {
  ADMIN_EMAIL,
  jsonOf,
  params,
  request,
  seedStandardWorld,
  setupAuthEnv,
} from './routes-support'

/**
 * End-to-end tests for the WRITE routes of the CRM booking tracker.
 *
 * The REAL access gate runs; only the sign-in session and the database client
 * are replaced. The database is a table-shaped fake so we can assert on the
 * exact rpc arguments the routes send and on what the serialized response
 * exposes.
 */

const world = vi.hoisted(() => ({
  sessionEmail: null as string | null,
  fake: null as { state: FakeState; reset: () => void } | null,
}))

vi.mock('@/lib/supabase-server', () => ({
  createServerSupabaseClient: () => ({
    auth: {
      getUser: async () => ({
        data: {
          user:
            world.sessionEmail === null
              ? null
              : { id: 'user-1', email: world.sessionEmail },
        },
      }),
    },
  }),
}))

vi.mock('@/lib/supabase', async () => {
  const mod = await import('@/lib/crm/__tests__/booking-fake-db')
  const fake = mod.createFakeDb()
  world.fake = { state: fake.state, reset: fake.reset }
  return { supabaseAdmin: fake.db }
})

import { POST as createPOST } from '../route'
import { PATCH as bookingPATCH } from '../[bookingId]/route'
import { POST as confirmDeparturePOST } from '../[bookingId]/confirm-departure/route'
import { POST as cancelPOST } from '../[bookingId]/cancel/route'
import { POST as paidPOST } from '../[bookingId]/milestones/[kind]/paid/route'
import { POST as unpaidPOST } from '../[bookingId]/milestones/[kind]/unpaid/route'
import { POST as overrideDuePOST } from '../[bookingId]/milestones/[kind]/override-due/route'
import { POST as nudgePOST } from '../[bookingId]/milestones/[kind]/nudge/route'

function state(): FakeState {
  if (world.fake === null) throw new Error('fake db not initialised')
  return world.fake.state
}

function signIn(email: string | null): void {
  world.sessionEmail = email
}

type Handler = (
  req: NextRequest,
  ctx: { params: Promise<{ id: string; bookingId: string; kind: string }> },
) => Promise<Response>

interface WriteCase {
  name: string
  rpc: string
  body: Record<string, unknown>
  call: (
    clientId: string,
    bookingId: string,
    body: unknown,
    kind?: string,
  ) => Promise<Response>
}

function callHandler(
  handler: Handler,
  method: string,
  clientId: string,
  bookingId: string,
  body: unknown,
  kind: string,
): Promise<Response> {
  return handler(
    request(method, body) as NextRequest,
    params(clientId, { bookingId, kind }),
  )
}

const WRITES: WriteCase[] = [
  {
    name: 'PATCH booking',
    rpc: 'crm_booking_update',
    body: { expectedUpdatedAt: UPDATED_AT, patch: { note: 'x' } },
    call: (clientId, bookingId, body) =>
      callHandler(bookingPATCH, 'PATCH', clientId, bookingId, body, 'balance'),
  },
  {
    name: 'POST confirm-departure',
    rpc: 'crm_booking_confirm_departure',
    body: { expectedUpdatedAt: UPDATED_AT },
    call: (clientId, bookingId, body) =>
      callHandler(confirmDeparturePOST, 'POST', clientId, bookingId, body, 'balance'),
  },
  {
    name: 'POST cancel',
    rpc: 'crm_booking_cancel',
    body: { expectedUpdatedAt: UPDATED_AT, cancelNote: 'changed plans' },
    call: (clientId, bookingId, body) =>
      callHandler(cancelPOST, 'POST', clientId, bookingId, body, 'balance'),
  },
  {
    name: 'POST paid',
    rpc: 'crm_booking_set_paid',
    body: { expectedUpdatedAt: UPDATED_AT, paidOn: '2026-10-08' },
    call: (clientId, bookingId, body, kind = 'balance') =>
      callHandler(paidPOST, 'POST', clientId, bookingId, body, kind),
  },
  {
    name: 'POST unpaid',
    rpc: 'crm_booking_unset_paid',
    body: { expectedUpdatedAt: UPDATED_AT },
    call: (clientId, bookingId, body, kind = 'balance') =>
      callHandler(unpaidPOST, 'POST', clientId, bookingId, body, kind),
  },
  {
    name: 'POST override-due',
    rpc: 'crm_booking_override_due',
    body: { expectedUpdatedAt: UPDATED_AT, dueOn: '2026-12-20' },
    call: (clientId, bookingId, body, kind = 'balance') =>
      callHandler(overrideDuePOST, 'POST', clientId, bookingId, body, kind),
  },
  {
    name: 'POST nudge',
    rpc: 'crm_booking_nudge',
    body: { expectedUpdatedAt: UPDATED_AT, mode: 'snooze', days: 7 },
    call: (clientId, bookingId, body, kind = 'balance') =>
      callHandler(nudgePOST, 'POST', clientId, bookingId, body, kind),
  },
]

const MILESTONE_ROUTES = new Set([
  'POST paid',
  'POST unpaid',
  'POST override-due',
  'POST nudge',
])

const FORBIDDEN_FIELDS = [
  'paid_source',
  'source',
  'actor',
  'actor_email',
  'p_server_detector',
  'client_id',
  'paid_evidence_ref',
]

const RANDOM_UUID = '99999999-0000-4000-8000-000000000000'

function createBody(over?: Record<string, unknown>): Record<string, unknown> {
  return {
    contactId: CONTACT_A1,
    tourId: TOUR_A1,
    departureId: DEP_A1,
    partySize: 2,
    isCruise: true,
    note: 'Li couple',
    ...over,
  }
}

function createCall(body: unknown, clientId = CLIENT_A): Promise<Response> {
  return createPOST(request('POST', body), params(clientId))
}

function rpcArgs(name: string): Record<string, unknown> {
  const call = state().rpcCalls.find((c) => c.name === name)
  if (call === undefined) throw new Error(`rpc ${name} was not called`)
  return call.args
}

function rpcCount(name: string): number {
  return state().rpcCalls.filter((c) => c.name === name).length
}

beforeEach(() => {
  if (world.fake === null) throw new Error('fake db not initialised')
  world.fake.reset()
  setupAuthEnv()
  seedStandardWorld(state())
  signIn(ADMIN_EMAIL)
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'info').mockImplementation(() => {})
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-12T00:00:00Z'))
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('forbidden fields', () => {
  it.each(WRITES)('$name rejects every forbidden field', async (write) => {
    for (const field of FORBIDDEN_FIELDS) {
      const res = await write.call(CLIENT_A, BOOKING_A1, {
        ...write.body,
        [field]: 'x',
      })
      expect(res.status).toBe(400)
      const body = await jsonOf(res)
      expect(body.error).toBe('forbidden_field')
      expect(body.field).toBe(field)
      expect(state().rpcCalls).toHaveLength(0)
    }
  })

  it('create rejects every forbidden field', async () => {
    for (const field of FORBIDDEN_FIELDS) {
      const res = await createCall(createBody({ [field]: 'x' }))
      expect(res.status).toBe(400)
      const body = await jsonOf(res)
      expect(body.error).toBe('forbidden_field')
      expect(body.field).toBe(field)
      expect(state().rpcCalls).toHaveLength(0)
    }
  })

  it('PATCH rejects a forbidden field nested inside patch', async () => {
    const res = await bookingPATCH(
      request('PATCH', { expectedUpdatedAt: UPDATED_AT, patch: { client_id: 'x' } }),
      params(CLIENT_A, { bookingId: BOOKING_A1, kind: 'balance' }),
    )
    expect(res.status).toBe(400)
    const body = await jsonOf(res)
    expect(body.error).toBe('forbidden_field')
    expect(body.field).toBe('client_id')
    expect(state().rpcCalls).toHaveLength(0)
  })

  it.each(['paidSource', 'actorEmail', 'clientId'])(
    'paid rejects camelCase %s',
    async (field) => {
      const res = await paidPOST(
        request('POST', { expectedUpdatedAt: UPDATED_AT, [field]: 'x' }),
        params(CLIENT_A, { bookingId: BOOKING_A1, kind: 'balance' }),
      )
      expect(res.status).toBe(400)
      const body = await jsonOf(res)
      expect(body.error).toBe('forbidden_field')
      expect(body.field).toBe(field)
      expect(state().rpcCalls).toHaveLength(0)
    },
  )
})

describe('IDOR', () => {
  it.each(WRITES)('$name refuses a booking of another client', async (write) => {
    const res = await write.call(CLIENT_A, BOOKING_B1, write.body)
    expect(res.status).toBe(404)
    expect(await jsonOf(res)).toEqual({ error: 'not_found' })
    expect(state().rpcCalls).toHaveLength(0)
  })

  it.each(WRITES)('$name returns 404 for an unknown booking', async (write) => {
    const res = await write.call(CLIENT_A, RANDOM_UUID, write.body)
    expect(res.status).toBe(404)
    expect(await jsonOf(res)).toEqual({ error: 'not_found' })
    expect(state().rpcCalls).toHaveLength(0)
  })

  it.each(WRITES)('$name returns 400 for a malformed booking id', async (write) => {
    const res = await write.call(CLIENT_A, 'abc', write.body)
    expect(res.status).toBe(400)
    expect(await jsonOf(res)).toEqual({ error: 'invalid_id' })
    expect(state().rpcCalls).toHaveLength(0)
  })

  it.each(WRITES.filter((w) => MILESTONE_ROUTES.has(w.name)))(
    '$name returns 400 for an unknown kind',
    async (write) => {
      const res = await write.call(CLIENT_A, BOOKING_A1, write.body, 'weird')
      expect(res.status).toBe(400)
      expect(await jsonOf(res)).toEqual({ error: 'invalid_kind' })
      expect(state().rpcCalls).toHaveLength(0)
    },
  )
})

describe('stale writes', () => {
  it.each(WRITES)('$name maps a stale conflict to 409', async (write) => {
    state().rpcErrors[write.rpc] = 'conflict:stale:xyz'
    const res = await write.call(CLIENT_A, BOOKING_A1, write.body)
    expect(res.status).toBe(409)
    const text = await res.clone().text()
    const body = await jsonOf(res)
    expect(body.error).toBe('stale')
    expect(typeof body.message).toBe('string')
    expect(body.message as string).toMatch(/[\u4e00-\u9fff]/)
    expect(text).not.toContain('xyz')
  })
})

describe('sql error mapping', () => {
  const cases: Array<{ sql: string; status: number; error: string }> = [
    { sql: 'invalid_patch:note', status: 400, error: 'invalid_patch:note' },
    { sql: 'booking_not_active', status: 409, error: 'booking_not_active' },
    { sql: 'duplicate_booking', status: 409, error: 'duplicate_booking' },
    { sql: 'evidence_required', status: 403, error: 'Forbidden' },
    { sql: 'booking_not_found', status: 404, error: 'not_found' },
    { sql: 'departure_not_found', status: 400, error: 'departure_not_found' },
    { sql: 'cross_client_reference:tour_id', status: 403, error: 'Forbidden' },
  ]

  it.each(cases)('maps $sql to $status', async (c) => {
    state().rpcErrors['crm_booking_update'] = c.sql
    const res = await bookingPATCH(
      request('PATCH', { expectedUpdatedAt: UPDATED_AT, patch: { note: 'x' } }),
      params(CLIENT_A, { bookingId: BOOKING_A1, kind: 'balance' }),
    )
    expect(res.status).toBe(c.status)
    expect(await jsonOf(res)).toMatchObject({ error: c.error })
  })

  it('maps an unknown sql failure to a generic 500', async () => {
    state().rpcErrors['crm_booking_update'] = 'weird database failure'
    const res = await bookingPATCH(
      request('PATCH', { expectedUpdatedAt: UPDATED_AT, patch: { note: 'x' } }),
      params(CLIENT_A, { bookingId: BOOKING_A1, kind: 'balance' }),
    )
    expect(res.status).toBe(500)
    const text = await res.clone().text()
    expect(await jsonOf(res)).toEqual({ error: 'booking_failed' })
    expect(text).not.toContain('weird database failure')
  })
})

describe('happy path rpc arguments', () => {
  it.each(WRITES)('$name sends the standard arguments', async (write) => {
    const res = await write.call(CLIENT_A, BOOKING_A1, write.body)
    expect(res.status).toBe(200)
    const body = await jsonOf(res)
    const booking = body.booking as Record<string, unknown>
    expect(booking.id).toBe(BOOKING_A1)
    expect(rpcCount(write.rpc)).toBe(1)
    const args = rpcArgs(write.rpc)
    expect(args.p_client_id).toBe(CLIENT_A)
    expect(args.p_booking_id).toBe(BOOKING_A1)
    expect(args.p_expected_updated_at).toBe(UPDATED_AT)
    expect(args.p_actor).toBe(ADMIN_EMAIL)
  })

  it('PATCH sends the mapped patch', async () => {
    await bookingPATCH(
      request('PATCH', { expectedUpdatedAt: UPDATED_AT, patch: { note: 'x' } }),
      params(CLIENT_A, { bookingId: BOOKING_A1, kind: 'balance' }),
    )
    expect(rpcArgs('crm_booking_update').p_patch).toEqual({ note: 'x' })
  })

  it('PATCH maps camelCase patch keys to snake_case', async () => {
    await bookingPATCH(
      request('PATCH', {
        expectedUpdatedAt: UPDATED_AT,
        patch: {
          tourId: TOUR_A1,
          departureId: null,
          bookedOn: '2026-10-13',
          partySize: 3,
          isCruise: true,
          note: '',
        },
      }),
      params(CLIENT_A, { bookingId: BOOKING_A1, kind: 'balance' }),
    )
    expect(rpcArgs('crm_booking_update').p_patch).toEqual({
      tour_id: TOUR_A1,
      departure_id: null,
      booked_on: '2026-10-13',
      party_size: 3,
      is_cruise: true,
      note: null,
    })
  })

  it('cancel sends the cancel note', async () => {
    await cancelPOST(
      request('POST', { expectedUpdatedAt: UPDATED_AT, cancelNote: 'changed plans' }),
      params(CLIENT_A, { bookingId: BOOKING_A1, kind: 'balance' }),
    )
    expect(rpcArgs('crm_booking_cancel').p_cancel_note).toBe('changed plans')
  })

  it('paid sends the paid arguments and reports changed', async () => {
    state().rpcData['crm_booking_set_paid'] = { changed: true, reason: null }
    const res = await paidPOST(
      request('POST', { expectedUpdatedAt: UPDATED_AT, paidOn: '2026-10-08' }),
      params(CLIENT_A, { bookingId: BOOKING_A1, kind: 'balance' }),
    )
    const args = rpcArgs('crm_booking_set_paid')
    expect(args.p_kind).toBe('balance')
    expect(args.p_paid_on).toBe('2026-10-08')
    expect(args.p_paid_source).toBe('staff')
    expect(args.p_evidence_ref).toBeNull()
    expect(args.p_server_detector).toBe(false)
    const body = await jsonOf(res)
    expect(body.changed).toBe(true)
  })

  it('paid rejects a date after today (NZ) with 400 and never calls the database function', async () => {
    const res = await paidPOST(
      request('POST', { expectedUpdatedAt: UPDATED_AT, paidOn: '2026-10-13' }),
      params(CLIENT_A, { bookingId: BOOKING_A1, kind: 'balance' }),
    )
    expect(res.status).toBe(400)
    expect((await jsonOf(res)).error).toBe('invalid_paid_on')
    expect(state().rpcCalls.filter((c) => c.name === 'crm_booking_set_paid')).toHaveLength(0)
  })

  it('paid accepts today in New Zealand even when UTC is still the day before', async () => {
    vi.setSystemTime(new Date('2026-10-11T12:30:00Z'))
    state().rpcData['crm_booking_set_paid'] = { changed: true, reason: null }
    const res = await paidPOST(
      request('POST', { expectedUpdatedAt: UPDATED_AT, paidOn: '2026-10-12' }),
      params(CLIENT_A, { bookingId: BOOKING_A1, kind: 'balance' }),
    )
    expect(res.status).toBe(200)
    expect(rpcArgs('crm_booking_set_paid').p_paid_on).toBe('2026-10-12')
  })

  it('paid reports an unchanged result', async () => {
    state().rpcData['crm_booking_set_paid'] = { changed: false, reason: 'already_paid' }
    const res = await paidPOST(
      request('POST', { expectedUpdatedAt: UPDATED_AT, paidOn: '2026-10-08' }),
      params(CLIENT_A, { bookingId: BOOKING_A1, kind: 'balance' }),
    )
    const body = await jsonOf(res)
    expect(body.changed).toBe(false)
    expect(body.reason).toBe('already_paid')
    expect(body.deal).toBeUndefined()
  })

  it('paid without a deal milestone does not attach a deal or insert a sale', async () => {
    state().rpcData['crm_booking_set_paid'] = { changed: true, reason: null }
    const res = await paidPOST(
      request('POST', { expectedUpdatedAt: UPDATED_AT, paidOn: '2026-10-08' }),
      params(CLIENT_A, { bookingId: BOOKING_A1, kind: 'deposit' }),
    )
    const body = await jsonOf(res)
    expect(res.status).toBe(200)
    expect(body.changed).toBe(true)
    expect(body.deal).toBeUndefined()
    expect(state().queries.some((q) => q.table === 'me_sale_outcomes')).toBe(false)
  })

  it('a failed deal record does not undo the payment', async () => {
    state().rpcData['crm_booking_set_paid'] = { changed: true, reason: null }
    const client = state().tables.clients.find((r) => r.id === CLIENT_A)
    if (client) {
      client.conversion_stage = 'live'
      client.leads_config = { ...ENABLED_LEADS_CONFIG, capi_deal_milestone: 'deposit' }
    }
    const booking = state().tables.crm_bookings.find((r) => r.id === BOOKING_A1)
    if (booking) booking.party_size = 2
    const deposit = state().tables.crm_booking_milestones.find((r) => r.booking_id === BOOKING_A1 && r.kind === 'deposit')
    if (deposit) deposit.paid_on = '2026-10-08'
    const contact = state().tables.contacts.find((r) => r.id === CONTACT_A1)
    if (contact) contact.primary_email = 'a@b.test'
    const tour = state().tables[TOURS_TABLE].find((r) => r.id === TOUR_A1)
    if (tour) tour.display_price_text = 'From NZD $100'
    const res = await paidPOST(
      request('POST', { expectedUpdatedAt: UPDATED_AT, paidOn: '2026-10-08' }),
      params(CLIENT_A, { bookingId: BOOKING_A1, kind: 'deposit' }),
    )
    const body = await jsonOf(res)
    expect(res.status).toBe(200)
    expect(body.changed).toBe(true)
    const deal = body.deal as { recorded: boolean; reason: string; message: string }
    expect(deal.recorded).toBe(false)
    expect(deal.reason).toBe('record_failed')
    expect(deal.message).toContain('款已记下')
  })

  it('override-due sends the override date', async () => {
    await overrideDuePOST(
      request('POST', { expectedUpdatedAt: UPDATED_AT, dueOn: '2026-12-20' }),
      params(CLIENT_A, { bookingId: BOOKING_A1, kind: 'balance' }),
    )
    expect(rpcArgs('crm_booking_override_due').p_due_override_on).toBe('2026-12-20')
  })

  it('override-due sends null when the date is cleared', async () => {
    await overrideDuePOST(
      request('POST', { expectedUpdatedAt: UPDATED_AT, dueOn: null }),
      params(CLIENT_A, { bookingId: BOOKING_A1, kind: 'balance' }),
    )
    expect(rpcArgs('crm_booking_override_due').p_due_override_on).toBeNull()
  })

  it('nudge sends the snooze arguments', async () => {
    await nudgePOST(
      request('POST', { expectedUpdatedAt: UPDATED_AT, mode: 'snooze', days: 7 }),
      params(CLIENT_A, { bookingId: BOOKING_A1, kind: 'balance' }),
    )
    const args = rpcArgs('crm_booking_nudge')
    expect(args.p_mode).toBe('snooze')
    expect(args.p_days).toBe(7)
  })

  it('nudge sends null days for quiet mode', async () => {
    await nudgePOST(
      request('POST', { expectedUpdatedAt: UPDATED_AT, mode: 'quiet' }),
      params(CLIENT_A, { bookingId: BOOKING_A1, kind: 'balance' }),
    )
    expect(rpcArgs('crm_booking_nudge').p_days).toBeNull()
  })

  it('nudge rejects an out-of-range snooze', async () => {
    const res = await nudgePOST(
      request('POST', { expectedUpdatedAt: UPDATED_AT, mode: 'snooze', days: 5 }),
      params(CLIENT_A, { bookingId: BOOKING_A1, kind: 'balance' }),
    )
    expect(res.status).toBe(400)
    expect(await jsonOf(res)).toEqual({ error: 'invalid_days' })
    expect(state().rpcCalls).toHaveLength(0)
  })

  it('unpaid sends the milestone kind', async () => {
    await unpaidPOST(
      request('POST', { expectedUpdatedAt: UPDATED_AT }),
      params(CLIENT_A, { bookingId: BOOKING_A1, kind: 'deposit' }),
    )
    expect(rpcArgs('crm_booking_unset_paid').p_kind).toBe('deposit')
  })

  it('unpaid voids a deal that has not been sent', async () => {
    const client = state().tables.clients.find((row) => row.id === CLIENT_A)
    if (client) client.leads_config = { ...ENABLED_LEADS_CONFIG, capi_deal_milestone: 'deposit' }
    state().tables.me_sale_outcomes = [{
      id: 'outcome-1',
      client_id: CLIENT_A,
      contact_id: CONTACT_A1,
      source_kind: 'crm_stage_manual',
      source_ref: `crm_deal:${CONTACT_A1}:${BOOKING_A1}`,
      review_status: 'pending_review',
    }]
    state().tables.me_conversion_writebacks = [{
      id: 'wb-1',
      outcome_id: 'outcome-1',
      status: 'queued',
      payload_preview: null,
    }]
    const res = await unpaidPOST(
      request('POST', { expectedUpdatedAt: UPDATED_AT }),
      params(CLIENT_A, { bookingId: BOOKING_A1, kind: 'deposit' }),
    )
    const body = await jsonOf(res)
    expect(res.status).toBe(200)
    expect(body.deal).toMatchObject({ reason: 'voided' })
    expect(String((body.deal as { message: string }).message)).toContain('已作废')
    expect(state().tables.me_sale_outcomes[0].review_status).toBe('rejected')
    expect(state().tables.me_sale_outcomes[0].reject_reason).toBe('not_real_sale')
    expect(state().tables.me_conversion_writebacks[0].status).toBe('failed_permanent')
    expect(rpcArgs('crm_booking_unset_paid').p_kind).toBe('deposit')
  })

  it('unpaid leaves an already sent deal and says so', async () => {
    const client = state().tables.clients.find((row) => row.id === CLIENT_A)
    if (client) client.leads_config = { ...ENABLED_LEADS_CONFIG, capi_deal_milestone: 'deposit' }
    state().tables.me_sale_outcomes = [{
      id: 'outcome-1',
      client_id: CLIENT_A,
      contact_id: CONTACT_A1,
      source_kind: 'crm_stage_manual',
      source_ref: `crm_deal:${CONTACT_A1}:${BOOKING_A1}`,
      review_status: 'approved',
    }]
    state().tables.me_conversion_writebacks = [{
      id: 'wb-1',
      outcome_id: 'outcome-1',
      status: 'confirmed',
      payload_preview: { held: false },
    }]
    const res = await unpaidPOST(
      request('POST', { expectedUpdatedAt: UPDATED_AT }),
      params(CLIENT_A, { bookingId: BOOKING_A1, kind: 'deposit' }),
    )
    const body = await jsonOf(res)
    expect(res.status).toBe(200)
    expect(String((body.deal as { message: string }).message)).toContain('已经发给广告平台')
    expect(state().tables.me_sale_outcomes[0].review_status).toBe('approved')
    expect(state().tables.me_conversion_writebacks[0].status).toBe('confirmed')
    expect(state().tables.me_conversion_writebacks[0].payload_preview).toMatchObject({ paymentRevoked: true })
  })
})

describe('unknown keys', () => {
  it('paid rejects a money amount', async () => {
    const res = await paidPOST(
      request('POST', { expectedUpdatedAt: UPDATED_AT, amount: 100 }),
      params(CLIENT_A, { bookingId: BOOKING_A1, kind: 'balance' }),
    )
    expect(res.status).toBe(400)
    expect(await jsonOf(res)).toEqual({ error: 'unknown_field:amount' })
    expect(state().rpcCalls).toHaveLength(0)
  })

  it('PATCH rejects a status change', async () => {
    const res = await bookingPATCH(
      request('PATCH', { expectedUpdatedAt: UPDATED_AT, patch: { status: 'cancelled' } }),
      params(CLIENT_A, { bookingId: BOOKING_A1, kind: 'balance' }),
    )
    expect(res.status).toBe(400)
    expect(await jsonOf(res)).toEqual({ error: 'unknown_field:status' })
    expect(state().rpcCalls).toHaveLength(0)
  })

  it('PATCH rejects an empty patch', async () => {
    const res = await bookingPATCH(
      request('PATCH', { expectedUpdatedAt: UPDATED_AT, patch: {} }),
      params(CLIENT_A, { bookingId: BOOKING_A1, kind: 'balance' }),
    )
    expect(res.status).toBe(400)
    expect(await jsonOf(res)).toEqual({ error: 'empty_patch' })
    expect(state().rpcCalls).toHaveLength(0)
  })

  it('rejects a missing expectedUpdatedAt', async () => {
    const res = await paidPOST(
      request('POST', { paidOn: '2026-10-08' }),
      params(CLIENT_A, { bookingId: BOOKING_A1, kind: 'balance' }),
    )
    expect(res.status).toBe(400)
    expect(await jsonOf(res)).toEqual({ error: 'invalid_expected_updated_at' })
    expect(state().rpcCalls).toHaveLength(0)
  })
})

describe('body problems', () => {
  it('rejects a non-JSON body', async () => {
    const res = await paidPOST(
      request('POST', 'not json'),
      params(CLIENT_A, { bookingId: BOOKING_A1, kind: 'balance' }),
    )
    expect(res.status).toBe(400)
    expect(await jsonOf(res)).toEqual({ error: 'invalid_json' })
    expect(state().rpcCalls).toHaveLength(0)
  })

  it('rejects a JSON array body', async () => {
    const res = await paidPOST(
      request('POST', [1, 2, 3]),
      params(CLIENT_A, { bookingId: BOOKING_A1, kind: 'balance' }),
    )
    expect(res.status).toBe(400)
    expect(await jsonOf(res)).toEqual({ error: 'invalid_body' })
    expect(state().rpcCalls).toHaveLength(0)
  })

  it('rejects an oversized body', async () => {
    const big = { expectedUpdatedAt: UPDATED_AT, note: 'x'.repeat(70 * 1024) }
    const res = await paidPOST(
      request('POST', big),
      params(CLIENT_A, { bookingId: BOOKING_A1, kind: 'balance' }),
    )
    expect(res.status).toBe(413)
    expect(state().rpcCalls).toHaveLength(0)
  })
})

describe('actor is the session', () => {
  function seedPaidMember(): void {
    state().tables.client_portal_users.push({
      email: 'staff@a.test',
      client_id: CLIENT_A,
      access_type: 'dashboard',
      scoped_admin: false,
    })
    state().tables.crm_booking_members.push({
      client_id: CLIENT_A,
      email: 'staff@a.test',
      granted_by: ADMIN_EMAIL,
      created_at: UPDATED_AT,
    })
  }

  it('paid uses the normalized session email as the actor', async () => {
    seedPaidMember()
    signIn('Staff@A.test')
    await paidPOST(
      request('POST', { expectedUpdatedAt: UPDATED_AT, paidOn: '2026-10-08' }),
      params(CLIENT_A, { bookingId: BOOKING_A1, kind: 'balance' }),
    )
    expect(rpcArgs('crm_booking_set_paid').p_actor).toBe('staff@a.test')
  })

  it('create uses the normalized session email as the actor', async () => {
    seedPaidMember()
    signIn('Staff@A.test')
    state().rpcData['crm_booking_create'] = { id: BOOKING_A1 }
    await createCall(createBody())
    expect(rpcArgs('crm_booking_create').p_actor).toBe('staff@a.test')
  })
})

describe('access first', () => {
  it('a paid user who is not on the list is refused', async () => {
    state().tables.client_portal_users.push({
      email: 'outsider@a.test',
      client_id: CLIENT_A,
      access_type: 'dashboard',
      scoped_admin: false,
    })
    signIn('outsider@a.test')
    const paid = await paidPOST(
      request('POST', { expectedUpdatedAt: UPDATED_AT, paidOn: '2026-10-08' }),
      params(CLIENT_A, { bookingId: BOOKING_A1, kind: 'balance' }),
    )
    expect(paid.status).toBe(403)
    const created = await createCall(createBody())
    expect(created.status).toBe(403)
    expect(state().rpcCalls).toHaveLength(0)
    expect(state().queries.some((q) => q.table === 'crm_bookings')).toBe(false)
  })

  it('a signed out user is refused', async () => {
    signIn(null)
    const res = await paidPOST(
      request('POST', { expectedUpdatedAt: UPDATED_AT, paidOn: '2026-10-08' }),
      params(CLIENT_A, { bookingId: BOOKING_A1, kind: 'balance' }),
    )
    expect(res.status).toBe(401)
    expect(state().rpcCalls).toHaveLength(0)
  })
})

describe('create', () => {
  beforeEach(() => {
    state().rpcData['crm_booking_create'] = { id: BOOKING_A1 }
  })

  it('creates a booking and returns the view', async () => {
    const res = await createCall(createBody())
    expect(res.status).toBe(201)
    const body = await jsonOf(res)
    const booking = body.booking as Record<string, unknown>
    expect(booking.id).toBe(BOOKING_A1)
    expect(rpcArgs('crm_booking_create')).toEqual({
      p_client_id: CLIENT_A,
      p_contact_id: CONTACT_A1,
      p_tour_id: TOUR_A1,
      p_departure_id: DEP_A1,
      p_booked_on: null,
      p_party_size: 2,
      p_is_cruise: true,
      p_note: 'Li couple',
      p_actor: ADMIN_EMAIL,
    })
  })

  it('refuses a contact of another client', async () => {
    const res = await createCall(createBody({ contactId: CONTACT_B1 }))
    expect(res.status).toBe(404)
    expect(await jsonOf(res)).toEqual({ error: 'not_found' })
    expect(state().rpcCalls).toHaveLength(0)
  })

  it('refuses an unknown contact', async () => {
    const res = await createCall(createBody({ contactId: RANDOM_UUID }))
    expect(res.status).toBe(404)
    expect(await jsonOf(res)).toEqual({ error: 'not_found' })
    expect(state().rpcCalls).toHaveLength(0)
  })

  it('rejects a missing tour id', async () => {
    const res = await createCall(createBody({ tourId: undefined }))
    expect(res.status).toBe(400)
    expect(await jsonOf(res)).toEqual({ error: 'invalid_tour_id' })
    expect(state().rpcCalls).toHaveLength(0)
  })

  it('rejects a malformed booked on date', async () => {
    const res = await createCall(createBody({ bookedOn: 'not-a-date' }))
    expect(res.status).toBe(400)
    expect(await jsonOf(res)).toEqual({ error: 'invalid_booked_on' })
    expect(state().rpcCalls).toHaveLength(0)
  })

  it.each([
    { sql: 'tour_not_found', status: 404 },
    { sql: 'departure_not_found', status: 404 },
  ])('maps $sql to $status', async (c) => {
    state().rpcErrors['crm_booking_create'] = c.sql
    const res = await createCall(createBody())
    expect(res.status).toBe(c.status)
    expect(await jsonOf(res)).toEqual({ error: 'not_found' })
  })

  it('maps duplicate_booking to a 409 with a Chinese message', async () => {
    state().rpcErrors['crm_booking_create'] = 'duplicate_booking'
    const res = await createCall(createBody())
    expect(res.status).toBe(409)
    const body = await jsonOf(res)
    expect(body).toMatchObject({ error: 'duplicate_booking' })
    expect(typeof body.message).toBe('string')
    expect(body.message as string).toMatch(/[\u4e00-\u9fff]/)
  })

  it('rejects an unknown body key', async () => {
    const res = await createCall(createBody({ paid: true }))
    expect(res.status).toBe(400)
    expect(await jsonOf(res)).toEqual({ error: 'unknown_field:paid' })
    expect(state().rpcCalls).toHaveLength(0)
  })
})

describe('responses never leak', () => {
  const LEAKS = [
    'client_id',
    'clientId',
    'created_by',
    'createdBy',
    'paid_evidence_ref',
    'p_actor',
  ]

  it.each(WRITES)('$name response is clean', async (write) => {
    const res = await write.call(CLIENT_A, BOOKING_A1, write.body)
    expect(res.status).toBe(200)
    const text = await res.clone().text()
    for (const leak of LEAKS) expect(text).not.toContain(leak)
  })

  it('create response is clean', async () => {
    state().rpcData['crm_booking_create'] = { id: BOOKING_A1 }
    const res = await createCall(createBody())
    expect(res.status).toBe(201)
    const text = await res.clone().text()
    for (const leak of LEAKS) expect(text).not.toContain(leak)
  })
})

describe('the route returns the re-read view', () => {
  it('PATCH returns milestones, warnings and updatedAt', async () => {
    const res = await bookingPATCH(
      request('PATCH', { expectedUpdatedAt: UPDATED_AT, patch: { note: 'x' } }),
      params(CLIENT_A, { bookingId: BOOKING_A1, kind: 'balance' }),
    )
    expect(res.status).toBe(200)
    const body = await jsonOf(res)
    const booking = body.booking as Record<string, unknown>
    expect(Array.isArray(booking.milestones)).toBe(true)
    expect((booking.milestones as unknown[]).length).toBe(2)
    expect(Array.isArray(booking.warnings)).toBe(true)
    expect(typeof booking.updatedAt).toBe('string')
  })
})
