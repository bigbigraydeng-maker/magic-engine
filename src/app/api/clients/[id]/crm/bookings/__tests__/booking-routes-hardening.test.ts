import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { FakeState } from '@/lib/crm/__tests__/booking-fake-db'
import {
  CLIENT_A,
  CONTACT_A1,
  TOUR_A1,
  DEP_A1,
  BOOKING_A1,
  UPDATED_AT,
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
 * Hardening tests for the CRM booking tracker routes.
 *
 * Same mocking pattern as booking-routes-write.test.ts: the REAL access gate
 * runs; only the sign-in session and the database client are replaced.
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
import { GET as bookingsGET } from '../route'
import { PATCH as bookingPATCH } from '../[bookingId]/route'
import { POST as confirmDeparturePOST } from '../[bookingId]/confirm-departure/route'
import { POST as cancelPOST } from '../[bookingId]/cancel/route'
import { POST as paidPOST } from '../[bookingId]/milestones/[kind]/paid/route'
import { POST as unpaidPOST } from '../[bookingId]/milestones/[kind]/unpaid/route'
import { POST as overrideDuePOST } from '../[bookingId]/milestones/[kind]/override-due/route'
import { POST as nudgePOST } from '../[bookingId]/milestones/[kind]/nudge/route'
import { GET as nudgeListGET } from '../nudge-list/route'
import { GET as membersGET, POST as membersPOST, DELETE as membersDELETE } from '../members/route'

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
  callReq: (
    req: NextRequest,
    clientId: string,
    bookingId: string,
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
    callReq: (req, clientId, bookingId, kind = 'balance') =>
      bookingPATCH(req, params(clientId, { bookingId, kind })),
  },
  {
    name: 'POST confirm-departure',
    rpc: 'crm_booking_confirm_departure',
    body: { expectedUpdatedAt: UPDATED_AT },
    call: (clientId, bookingId, body) =>
      callHandler(confirmDeparturePOST, 'POST', clientId, bookingId, body, 'balance'),
    callReq: (req, clientId, bookingId, kind = 'balance') =>
      confirmDeparturePOST(req, params(clientId, { bookingId, kind })),
  },
  {
    name: 'POST cancel',
    rpc: 'crm_booking_cancel',
    body: { expectedUpdatedAt: UPDATED_AT, cancelNote: 'changed plans' },
    call: (clientId, bookingId, body) =>
      callHandler(cancelPOST, 'POST', clientId, bookingId, body, 'balance'),
    callReq: (req, clientId, bookingId, kind = 'balance') =>
      cancelPOST(req, params(clientId, { bookingId, kind })),
  },
  {
    name: 'POST paid',
    rpc: 'crm_booking_set_paid',
    body: { expectedUpdatedAt: UPDATED_AT, paidOn: '2026-10-08' },
    call: (clientId, bookingId, body, kind = 'balance') =>
      callHandler(paidPOST, 'POST', clientId, bookingId, body, kind),
    callReq: (req, clientId, bookingId, kind = 'balance') =>
      paidPOST(req, params(clientId, { bookingId, kind })),
  },
  {
    name: 'POST unpaid',
    rpc: 'crm_booking_unset_paid',
    body: { expectedUpdatedAt: UPDATED_AT },
    call: (clientId, bookingId, body, kind = 'balance') =>
      callHandler(unpaidPOST, 'POST', clientId, bookingId, body, kind),
    callReq: (req, clientId, bookingId, kind = 'balance') =>
      unpaidPOST(req, params(clientId, { bookingId, kind })),
  },
  {
    name: 'POST override-due',
    rpc: 'crm_booking_override_due',
    body: { expectedUpdatedAt: UPDATED_AT, dueOn: '2026-12-20' },
    call: (clientId, bookingId, body, kind = 'balance') =>
      callHandler(overrideDuePOST, 'POST', clientId, bookingId, body, kind),
    callReq: (req, clientId, bookingId, kind = 'balance') =>
      overrideDuePOST(req, params(clientId, { bookingId, kind })),
  },
  {
    name: 'POST nudge',
    rpc: 'crm_booking_nudge',
    body: { expectedUpdatedAt: UPDATED_AT, mode: 'snooze', days: 7 },
    call: (clientId, bookingId, body, kind = 'balance') =>
      callHandler(nudgePOST, 'POST', clientId, bookingId, body, kind),
    callReq: (req, clientId, bookingId, kind = 'balance') =>
      nudgePOST(req, params(clientId, { bookingId, kind })),
  },
]

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

/** Build a request with an explicit content-type header (or none). */
function rawRequest(
  method: string,
  body: string,
  contentType: string | null,
): NextRequest {
  const headers: Record<string, string> = {}
  if (contentType !== null) headers['content-type'] = contentType
  return new NextRequest('http://localhost/x', { method, body, headers })
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

describe('H2 commit then view fails', () => {
  it('create returns needsRefresh when the view re-read fails', async () => {
    state().rpcData['crm_booking_create'] = { id: BOOKING_A1 }
    state().failAfter['crm_bookings'] = 0
    const res = await createCall(createBody())
    expect(res.status).toBe(201)
    const text = await res.clone().text()
    const body = await jsonOf(res)
    expect(body.ok).toBe(true)
    expect(body.needsRefresh).toBe(true)
    expect(body.bookingId).toBe(BOOKING_A1)
    expect('booking' in body).toBe(false)
    expect(rpcCount('crm_booking_create')).toBe(1)
    expect(text).not.toContain('boom')
  })

  it.each(WRITES)('$name returns needsRefresh when the view re-read fails', async (write) => {
    state().failAfter['crm_bookings'] = 1
    const res = await write.call(CLIENT_A, BOOKING_A1, write.body)
    expect(res.status).toBe(200)
    const text = await res.clone().text()
    const body = await jsonOf(res)
    expect(body.ok).toBe(true)
    expect(body.needsRefresh).toBe(true)
    expect(body.bookingId).toBe(BOOKING_A1)
    expect('booking' in body).toBe(false)
    expect(rpcCount(write.rpc)).toBe(1)
    expect(text).not.toContain('boom')
  })

  it('paid keeps changed and reason extras on needsRefresh', async () => {
    state().rpcData['crm_booking_set_paid'] = { changed: true, reason: null }
    state().failAfter['crm_bookings'] = 1
    const res = await paidPOST(
      request('POST', { expectedUpdatedAt: UPDATED_AT, paidOn: '2026-10-08' }),
      params(CLIENT_A, { bookingId: BOOKING_A1, kind: 'balance' }),
    )
    expect(res.status).toBe(200)
    const body = await jsonOf(res)
    expect(body.ok).toBe(true)
    expect(body.needsRefresh).toBe(true)
    expect(body.bookingId).toBe(BOOKING_A1)
    expect(body.changed).toBe(true)
    expect(body.reason).toBeNull()
    expect('booking' in body).toBe(false)
  })

  it('a stale write is still 409 even when the view table is broken', async () => {
    state().rpcErrors['crm_booking_update'] = 'conflict:stale:xyz'
    state().failAfter['crm_bookings'] = 1
    const res = await bookingPATCH(
      request('PATCH', { expectedUpdatedAt: UPDATED_AT, patch: { note: 'x' } }),
      params(CLIENT_A, { bookingId: BOOKING_A1, kind: 'balance' }),
    )
    expect(res.status).toBe(409)
    expect(await jsonOf(res)).toMatchObject({ error: 'stale' })
  })
})

describe('H3 missing reference reclassification', () => {
  it.each(['tour_not_found', 'departure_not_found', 'contact_not_found'])(
    'PATCH maps %s to a 400 with that code',
    async (code) => {
      state().rpcErrors['crm_booking_update'] = code
      const res = await bookingPATCH(
        request('PATCH', { expectedUpdatedAt: UPDATED_AT, patch: { note: 'x' } }),
        params(CLIENT_A, { bookingId: BOOKING_A1, kind: 'balance' }),
      )
      expect(res.status).toBe(400)
      expect(await jsonOf(res)).toEqual({ error: code })
    },
  )

  it('PATCH maps booking_not_found to a 404 not_found', async () => {
    state().rpcErrors['crm_booking_update'] = 'booking_not_found'
    const res = await bookingPATCH(
      request('PATCH', { expectedUpdatedAt: UPDATED_AT, patch: { note: 'x' } }),
      params(CLIENT_A, { bookingId: BOOKING_A1, kind: 'balance' }),
    )
    expect(res.status).toBe(404)
    expect(await jsonOf(res)).toEqual({ error: 'not_found' })
  })

  it('create still maps tour_not_found to a 404 not_found', async () => {
    state().rpcData['crm_booking_create'] = { id: BOOKING_A1 }
    state().rpcErrors['crm_booking_create'] = 'tour_not_found'
    const res = await createCall(createBody())
    expect(res.status).toBe(404)
    expect(await jsonOf(res)).toEqual({ error: 'not_found' })
  })
})

describe('H4 content-type enforcement', () => {
  const VALID_BODIES: Array<{ name: string; body: Record<string, unknown> }> = [
    { name: 'create', body: createBody() },
    ...WRITES.map((w) => ({ name: w.name, body: w.body })),
    { name: 'members POST', body: { email: 'new@a.test' } },
  ]

  function callByName(name: string, body: unknown, req: NextRequest): Promise<Response> {
    if (name === 'create') return createPOST(req, params(CLIENT_A))
    if (name === 'members POST') return membersPOST(req, params(CLIENT_A))
    const write = WRITES.find((w) => w.name === name)
    if (write === undefined) throw new Error(`unknown case ${name}`)
    return write.callReq(req, CLIENT_A, BOOKING_A1)
  }

  it.each(VALID_BODIES)('$name rejects text/plain with 415', async (c) => {
    const req = rawRequest('POST', JSON.stringify(c.body), 'text/plain')
    const res = await callByName(c.name, c.body, req)
    expect(res.status).toBe(415)
    expect(await jsonOf(res)).toEqual({ error: 'unsupported_media_type' })
    expect(state().rpcCalls).toHaveLength(0)
    if (c.name === 'members POST') {
      expect(state().tables.crm_booking_members).toHaveLength(0)
    }
  })

  it.each(VALID_BODIES)('$name rejects a missing content-type with 415', async (c) => {
    const req = rawRequest('POST', JSON.stringify(c.body), null)
    const res = await callByName(c.name, c.body, req)
    expect(res.status).toBe(415)
    expect(await jsonOf(res)).toEqual({ error: 'unsupported_media_type' })
    expect(state().rpcCalls).toHaveLength(0)
  })

  it.each(VALID_BODIES)('$name rejects application/jsonp with 415', async (c) => {
    const req = rawRequest('POST', JSON.stringify(c.body), 'application/jsonp')
    const res = await callByName(c.name, c.body, req)
    expect(res.status).toBe(415)
    expect(await jsonOf(res)).toEqual({ error: 'unsupported_media_type' })
    expect(state().rpcCalls).toHaveLength(0)
  })

  it.each(VALID_BODIES)('$name accepts application/json; charset=utf-8', async (c) => {
    const req = rawRequest('POST', JSON.stringify(c.body), 'application/json; charset=utf-8')
    const res = await callByName(c.name, c.body, req)
    expect(res.status).not.toBe(415)
  })

  it.each(VALID_BODIES)('$name accepts APPLICATION/JSON', async (c) => {
    const req = rawRequest('POST', JSON.stringify(c.body), 'APPLICATION/JSON')
    const res = await callByName(c.name, c.body, req)
    expect(res.status).not.toBe(415)
  })

  it('GET bookings needs no content-type', async () => {
    const res = await bookingsGET(
      new NextRequest('http://localhost/x', { method: 'GET' }),
      params(CLIENT_A),
    )
    expect(res.status).not.toBe(415)
  })

  it('GET nudge-list needs no content-type', async () => {
    const res = await nudgeListGET(
      new NextRequest('http://localhost/x', { method: 'GET' }),
      params(CLIENT_A),
    )
    expect(res.status).not.toBe(415)
  })

  it('GET members needs no content-type', async () => {
    const res = await membersGET(
      new NextRequest('http://localhost/x', { method: 'GET' }),
      params(CLIENT_A),
    )
    expect(res.status).not.toBe(415)
  })

  it('DELETE members needs no content-type', async () => {
    const res = await membersDELETE(
      new NextRequest('http://localhost/x?email=x%40a.test', { method: 'DELETE' }),
      params(CLIENT_A),
    )
    expect(res.status).not.toBe(415)
  })
})

describe('H5 NUL and control characters', () => {
  it('create rejects a NUL in the note', async () => {
    const res = await createCall(createBody({ note: 'a\u0000b' }))
    expect(res.status).toBe(400)
    expect(await jsonOf(res)).toEqual({ error: 'invalid_note' })
    expect(state().rpcCalls).toHaveLength(0)
  })

  it('PATCH rejects a NUL in the note', async () => {
    const res = await bookingPATCH(
      request('PATCH', { expectedUpdatedAt: UPDATED_AT, patch: { note: 'a\u0000b' } }),
      params(CLIENT_A, { bookingId: BOOKING_A1, kind: 'balance' }),
    )
    expect(res.status).toBe(400)
    expect(await jsonOf(res)).toEqual({ error: 'invalid_note' })
    expect(state().rpcCalls).toHaveLength(0)
  })

  it('cancel rejects a NUL in the cancel note', async () => {
    const res = await cancelPOST(
      request('POST', { expectedUpdatedAt: UPDATED_AT, cancelNote: 'a\u0000b' }),
      params(CLIENT_A, { bookingId: BOOKING_A1, kind: 'balance' }),
    )
    expect(res.status).toBe(400)
    expect(await jsonOf(res)).toEqual({ error: 'invalid_cancel_note' })
    expect(state().rpcCalls).toHaveLength(0)
  })

  it('members POST rejects a NUL in the email', async () => {
    const res = await membersPOST(
      request('POST', { email: 'a\u0000@x.test' }),
      params(CLIENT_A),
    )
    expect(res.status).toBe(400)
    expect(await jsonOf(res)).toEqual({ error: 'invalid_email' })
    expect(state().tables.crm_booking_members).toHaveLength(0)
  })

  it('members DELETE rejects a NUL in the email', async () => {
    const res = await membersDELETE(
      new NextRequest('http://localhost/x?email=a%00%40x.test', { method: 'DELETE' }),
      params(CLIENT_A),
    )
    expect(res.status).toBe(400)
    expect(await jsonOf(res)).toEqual({ error: 'invalid_email' })
  })

  it('PATCH accepts a note with newline and tab', async () => {
    const res = await bookingPATCH(
      request('PATCH', { expectedUpdatedAt: UPDATED_AT, patch: { note: 'a\nb\tc' } }),
      params(CLIENT_A, { bookingId: BOOKING_A1, kind: 'balance' }),
    )
    expect(res.status).toBe(200)
  })
})

describe('H1 expectedUpdatedAt over HTTP', () => {
  it('paid rejects a non-ISO expectedUpdatedAt', async () => {
    const res = await paidPOST(
      request('POST', { expectedUpdatedAt: 'Oct 1 2026', paidOn: '2026-10-08' }),
      params(CLIENT_A, { bookingId: BOOKING_A1, kind: 'balance' }),
    )
    expect(res.status).toBe(400)
    expect(await jsonOf(res)).toEqual({ error: 'invalid_expected_updated_at' })
    expect(state().rpcCalls).toHaveLength(0)
  })

  it('paid passes a valid ISO timestamp to the rpc unchanged', async () => {
    const iso = '2026-10-01T00:00:00.123456+00:00'
    await paidPOST(
      request('POST', { expectedUpdatedAt: iso, paidOn: '2026-10-08' }),
      params(CLIENT_A, { bookingId: BOOKING_A1, kind: 'balance' }),
    )
    expect(rpcArgs('crm_booking_set_paid').p_expected_updated_at).toBe(iso)
  })

  it('maps a database cast error to a 400 invalid_input', async () => {
    state().rpcErrors['crm_booking_update'] = 'invalid input syntax for type date: "x"'
    const res = await bookingPATCH(
      request('PATCH', { expectedUpdatedAt: UPDATED_AT, patch: { note: 'x' } }),
      params(CLIENT_A, { bookingId: BOOKING_A1, kind: 'balance' }),
    )
    expect(res.status).toBe(400)
    const text = await res.clone().text()
    expect(await jsonOf(res)).toEqual({ error: 'invalid_input' })
    expect(text).not.toContain('invalid input syntax')
  })
})
