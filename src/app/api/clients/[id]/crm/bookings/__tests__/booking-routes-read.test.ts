import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FakeState, Row } from '@/lib/crm/__tests__/booking-fake-db'
import {
  CLIENT_A,
  CLIENT_B,
  CONTACT_A1,
  CONTACT_A2,
  CONTACT_B1,
  BOOKING_A1,
  BOOKING_A2,
  BOOKING_B1,
  bookingPair,
  DEPARTURES_TABLE,
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
 * End-to-end tests for the READ routes of the CRM booking tracker.
 *
 * The REAL access gate runs; only the sign-in session and the database client
 * are replaced. The database is a table-shaped fake so we can assert on the
 * exact rows the routes read and on what the serialized response exposes.
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

import { GET as bookingsGET } from '../route'
import { GET as nudgeListGET } from '../nudge-list/route'

function state(): FakeState {
  if (world.fake === null) throw new Error('fake db not initialised')
  return world.fake.state
}

function signIn(email: string | null): void {
  world.sessionEmail = email
}

function bookingsFor(clientId: string, contactId: string): Promise<Response> {
  return bookingsGET(request('GET', undefined, `?contactId=${contactId}`), params(clientId))
}

function nudgeListFor(clientId: string, query = ''): Promise<Response> {
  return nudgeListGET(request('GET', undefined, query), params(clientId))
}

interface BookingView {
  id: string
  tourName: string
  status: string
  updatedAt: string
  needsConfirm: boolean
  warnings: Array<{ code: string; needsConfirm: boolean }>
  milestones: Array<{ kind: string; label: string; updatedAt: string }>
}

interface NudgeRow {
  bookingId: string
  contactId: string
  contactName: string
  kind: string
  label: string
  dueOn: string
  dueInDays: number
  bucket: string
  milestoneUpdatedAt: string
}

interface NudgePayload {
  nudge: {
    rows: NudgeRow[]
    more: boolean
    collapsedOverdue: number
    truncated: boolean
  }
}

function bookingsOf(body: Record<string, unknown>): BookingView[] {
  return body.bookings as BookingView[]
}

function nudgeOf(body: Record<string, unknown>): NudgePayload['nudge'] {
  return (body as unknown as NudgePayload).nudge
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

describe('GET bookings', () => {
  it('returns one view for an own contact with no leaked fields', async () => {
    const res = await bookingsFor(CLIENT_A, CONTACT_A1)
    expect(res.status).toBe(200)
    const text = await res.clone().text()
    const body = await jsonOf(res)
    const views = bookingsOf(body)
    expect(views).toHaveLength(1)
    const view = views[0]
    expect(view.id).toBe(BOOKING_A1)
    expect(view.tourName).toBe('New Zealand South and North Island')
    expect(view.milestones.map((m) => m.label)).toEqual(['定金', '尾款'])
    expect(typeof view.updatedAt).toBe('string')
    for (const m of view.milestones) expect(typeof m.updatedAt).toBe('string')
    for (const leak of [
      'client_id',
      'clientId',
      'created_by',
      'createdBy',
      'paid_evidence_ref',
      'departureDepartOn',
    ]) {
      expect(text).not.toContain(leak)
    }
  })

  it('refuses a contact that belongs to another client (IDOR)', async () => {
    const res = await bookingsFor(CLIENT_A, CONTACT_B1)
    expect(res.status).toBe(404)
    expect(await jsonOf(res)).toEqual({ error: 'not_found' })
  })

  it('never leaks client B bookings even when asking for client A contact', async () => {
    const res = await bookingsFor(CLIENT_A, CONTACT_A1)
    const body = await jsonOf(res)
    const ids = bookingsOf(body).map((b) => b.id)
    expect(ids).not.toContain(BOOKING_B1)
  })

  it('returns 404 for an unknown contact id', async () => {
    const res = await bookingsFor(CLIENT_A, '99999999-0000-4000-8000-000000000000')
    expect(res.status).toBe(404)
    expect(await jsonOf(res)).toEqual({ error: 'not_found' })
  })

  it('returns 400 when contactId is missing', async () => {
    const res = await bookingsGET(request('GET'), params(CLIENT_A))
    expect(res.status).toBe(400)
    expect(await jsonOf(res)).toEqual({ error: 'invalid_contact_id' })
  })

  it('returns 400 when contactId is not a uuid', async () => {
    const res = await bookingsFor(CLIENT_A, 'abc')
    expect(res.status).toBe(400)
    expect(await jsonOf(res)).toEqual({ error: 'invalid_contact_id' })
  })

  it('returns an empty list for a contact with no bookings', async () => {
    const res = await bookingsFor(CLIENT_A, CONTACT_A2)
    expect(res.status).toBe(200)
    expect(await jsonOf(res)).toEqual({ bookings: [] })
  })

  it('returns cancelled bookings with status cancelled and no warnings', async () => {
    const rows = state().tables.crm_bookings
    const booking = rows.find((r) => r.id === BOOKING_A1)
    if (booking === undefined) throw new Error('seeded booking missing')
    booking.status = 'cancelled'
    booking.cancel_note = 'changed plans'
    const res = await bookingsFor(CLIENT_A, CONTACT_A1)
    const view = bookingsOf(await jsonOf(res))[0]
    expect(view.status).toBe('cancelled')
    expect(view.warnings).toEqual([])
  })

  it('warns when the live departure date differs from the snapshot', async () => {
    const deps = state().tables[DEPARTURES_TABLE]
    const dep = deps.find((r) => r.id === '20000000-0000-4000-8000-0000000000a1')
    if (dep === undefined) throw new Error('seeded departure missing')
    dep.depart_on = '2027-03-19'
    const res = await bookingsFor(CLIENT_A, CONTACT_A1)
    const view = bookingsOf(await jsonOf(res))[0]
    const warning = view.warnings.find((w) => w.code === 'departure_changed')
    expect(warning).toBeDefined()
    expect(warning?.needsConfirm).toBe(true)
  })

  it('fails closed with booking_failed when the bookings table errors', async () => {
    state().failTables.add('crm_bookings')
    const res = await bookingsFor(CLIENT_A, CONTACT_A1)
    expect(res.status).toBe(500)
    const text = await res.clone().text()
    expect(await jsonOf(res)).toEqual({ error: 'booking_failed' })
    expect(text).not.toContain('boom')
  })
})

describe('GET nudge-list', () => {
  function paySeededMilestones(): void {
    for (const m of state().tables.crm_booking_milestones) {
      if (m.booking_id === BOOKING_A1) {
        m.state = 'paid'
        m.paid_on = '2026-10-01'
        m.paid_source = 'staff'
      }
    }
  }

  function seedNudgeBookings(): void {
    const specs: Array<{ id: string; contact: string; dueOn: string }> = [
      { id: '30000000-0000-4000-8000-0000000000c1', contact: CONTACT_A1, dueOn: '2026-10-07' },
      { id: '30000000-0000-4000-8000-0000000000c2', contact: CONTACT_A2, dueOn: '2026-10-14' },
      { id: '30000000-0000-4000-8000-0000000000c3', contact: CONTACT_A1, dueOn: '2026-10-20' },
    ]
    for (const spec of specs) {
      const pair = bookingPair(spec.id, CLIENT_A, {
        booking: { contact_id: spec.contact },
        deposit: { state: 'paid', paid_on: '2026-10-01', paid_source: 'staff' },
        balance: {
          due_override_on: spec.dueOn,
          due_override_depart_on: '2027-03-12',
        },
      })
      state().tables.crm_bookings.push(pair[0])
      state().tables.crm_booking_milestones.push(pair[1], pair[2])
    }
  }

  it('lists the three balance rows ordered by due date', async () => {
    paySeededMilestones()
    seedNudgeBookings()
    const res = await nudgeListFor(CLIENT_A)
    expect(res.status).toBe(200)
    const nudge = nudgeOf(await jsonOf(res))
    expect(nudge.rows).toHaveLength(3)
    expect(nudge.rows.map((r) => r.dueOn)).toEqual([
      '2026-10-07',
      '2026-10-14',
      '2026-10-20',
    ])
    for (const row of nudge.rows) {
      expect(row.kind).toBe('balance')
      expect(row.label).toBe('尾款')
      expect(typeof row.bookingId).toBe('string')
      expect(typeof row.contactId).toBe('string')
      expect(typeof row.contactName).toBe('string')
      expect(typeof row.dueInDays).toBe('number')
      expect(typeof row.bucket).toBe('string')
      expect(typeof row.milestoneUpdatedAt).toBe('string')
    }
    expect(nudge.rows.map((r) => r.bookingId)).not.toContain(BOOKING_B1)
  })

  it('honours ?limit=2 and reports more', async () => {
    paySeededMilestones()
    seedNudgeBookings()
    const res = await nudgeListFor(CLIENT_A, '?limit=2')
    const nudge = nudgeOf(await jsonOf(res))
    expect(nudge.rows).toHaveLength(2)
    expect(nudge.more).toBe(true)
  })

  it('falls back to the default limit for a non-numeric limit', async () => {
    paySeededMilestones()
    seedNudgeBookings()
    const res = await nudgeListFor(CLIENT_A, '?limit=abc')
    const nudge = nudgeOf(await jsonOf(res))
    expect(nudge.rows).toHaveLength(3)
  })

  it('never lists client B bookings', async () => {
    paySeededMilestones()
    seedNudgeBookings()
    const res = await nudgeListFor(CLIENT_A)
    const text = await res.clone().text()
    expect(text).not.toContain(BOOKING_B1)
    expect(text).not.toContain('client_id')
  })
})

describe('read routes require a session', () => {
  it('GET bookings is 401 and touches no booking tables', async () => {
    signIn(null)
    const res = await bookingsFor(CLIENT_A, CONTACT_A1)
    expect(res.status).toBe(401)
    expect(state().queries.some((q) => q.table === 'crm_bookings')).toBe(false)
  })

  it('GET nudge-list is 401 and touches no booking tables', async () => {
    signIn(null)
    const res = await nudgeListFor(CLIENT_A)
    expect(res.status).toBe(401)
    expect(state().queries.some((q) => q.table === 'crm_bookings')).toBe(false)
  })
})
