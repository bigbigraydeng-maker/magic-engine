import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FakeState, Row } from '@/lib/crm/__tests__/booking-fake-db'
import {
  CLIENT_A,
  CLIENT_B,
  TOUR_A1,
  TOUR_B1,
  DEP_A1,
  DEP_B1,
  DISABLED_LEADS_CONFIG,
  departureRow,
  tourRow,
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
 * End-to-end tests for the READ route GET /api/clients/[id]/crm/bookings/options
 * and its helper src/lib/crm/booking-options.ts.
 *
 * The REAL access gate runs; only the sign-in session and the database client
 * are replaced. The database is a table-shaped fake so we can assert on the
 * exact rows the route reads and on what the serialized response exposes.
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

import { GET as optionsGET } from '../options/route'

function state(): FakeState {
  if (world.fake === null) throw new Error('fake db not initialised')
  return world.fake.state
}

function signIn(email: string | null): void {
  world.sessionEmail = email
}

function optionsFor(clientId: string): Promise<Response> {
  return optionsGET(request('GET', undefined, '/options'), params(clientId))
}

interface DepartureView {
  id: string
  departOn: string
  returnOn: string | null
  status: string
}

interface TourView {
  id: string
  name: string
  durationText: string | null
  departures: DepartureView[]
}

function toursOf(body: Record<string, unknown>): TourView[] {
  return body.tours as TourView[]
}

function tourById(tours: TourView[], id: string): TourView | undefined {
  return tours.find((t) => t.id === id)
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

describe('GET options', () => {
  it('returns client A tours with their departures and never leaks client B', async () => {
    const res = await optionsFor(CLIENT_A)
    expect(res.status).toBe(200)
    const text = await res.clone().text()
    const body = await jsonOf(res)
    const tours = toursOf(body)
    expect(Array.isArray(tours)).toBe(true)

    const tourA = tourById(tours, TOUR_A1)
    expect(tourA).toBeDefined()
    const departureIds = (tourA?.departures ?? []).map((d) => d.id)
    expect(departureIds).toContain(DEP_A1)
    const depA = (tourA?.departures ?? []).find((d) => d.id === DEP_A1)
    expect(depA?.departOn).toBe('2027-03-12')

    expect(text).not.toContain(TOUR_B1)
    expect(text).not.toContain(DEP_B1)
  })

  it('exposes exactly the documented keys on tours and departures', async () => {
    const res = await optionsFor(CLIENT_A)
    const tours = toursOf(await jsonOf(res))
    expect(tours.length).toBeGreaterThan(0)
    for (const tour of tours) {
      expect(Object.keys(tour).sort()).toEqual(['departures', 'durationText', 'id', 'name'])
      for (const departure of tour.departures) {
        expect(Object.keys(departure).sort()).toEqual(['departOn', 'id', 'returnOn', 'status'])
      }
    }
  })

  it('never reads or returns private departure columns', async () => {
    const deps = state().tables[DEPARTURES_TABLE]
    const dep = deps.find((r) => r.id === DEP_A1)
    if (dep === undefined) throw new Error('seeded departure missing')
    dep.internal = { cost: 'SECRET-COST' }
    dep.price_text_override = 'SECRET-PRICE'

    const res = await optionsFor(CLIENT_A)
    const text = await res.clone().text()
    expect(text).not.toContain('SECRET-COST')
    expect(text).not.toContain('SECRET-PRICE')
    expect(text).not.toContain('internal')

    const departureQueries = state().queries.filter((q) => q.table === DEPARTURES_TABLE)
    expect(departureQueries.length).toBeGreaterThan(0)
    for (const query of departureQueries) {
      const columns = query.columns ?? ''
      expect(columns).not.toContain('internal')
      expect(columns).not.toContain('price')
    }
  })

  it('excludes past, cancelled and closed departures and sorts the rest by date', async () => {
    const deps = state().tables[DEPARTURES_TABLE]
    const extra: Row[] = [
      departureRow({ id: '20000000-0000-4000-8000-0000000000e1', tour_id: TOUR_A1, client_id: CLIENT_A, depart_on: '2026-10-11', status: 'open' }),
      departureRow({ id: '20000000-0000-4000-8000-0000000000e2', tour_id: TOUR_A1, client_id: CLIENT_A, depart_on: '2026-10-12', status: 'open' }),
      departureRow({ id: '20000000-0000-4000-8000-0000000000e3', tour_id: TOUR_A1, client_id: CLIENT_A, depart_on: '2027-01-01', status: 'cancelled' }),
      departureRow({ id: '20000000-0000-4000-8000-0000000000e4', tour_id: TOUR_A1, client_id: CLIENT_A, depart_on: '2027-01-02', status: 'closed' }),
      departureRow({ id: '20000000-0000-4000-8000-0000000000e5', tour_id: TOUR_A1, client_id: CLIENT_A, depart_on: '2027-01-03', status: 'sold_out' }),
      departureRow({ id: '20000000-0000-4000-8000-0000000000e6', tour_id: TOUR_A1, client_id: CLIENT_A, depart_on: '2027-01-04', status: 'limited' }),
    ]
    for (const row of extra) deps.push(row)

    const res = await optionsFor(CLIENT_A)
    const tours = toursOf(await jsonOf(res))
    const tourA = tourById(tours, TOUR_A1)
    const departures = tourA?.departures ?? []
    const ids = departures.map((d) => d.id)
    expect(ids).not.toContain('20000000-0000-4000-8000-0000000000e1')
    expect(ids).toContain('20000000-0000-4000-8000-0000000000e2')
    expect(ids).not.toContain('20000000-0000-4000-8000-0000000000e3')
    expect(ids).not.toContain('20000000-0000-4000-8000-0000000000e4')
    expect(ids).toContain('20000000-0000-4000-8000-0000000000e5')
    expect(ids).toContain('20000000-0000-4000-8000-0000000000e6')

    const dates = departures.map((d) => d.departOn)
    const sorted = dates.slice().sort()
    expect(dates).toEqual(sorted)
  })

  it('lists a tour with no future departures, hides inactive tours and foreign departures', async () => {
    const tours = state().tables[TOURS_TABLE]
    tours.push(tourRow({ id: '10000000-0000-4000-8000-0000000000a2', client_id: CLIENT_A, name: 'Empty Tour' }))
    tours.push(tourRow({ id: '10000000-0000-4000-8000-0000000000a3', client_id: CLIENT_A, name: 'Inactive Tour', is_active: false }))
    state().tables[DEPARTURES_TABLE].push(
      departureRow({ id: '20000000-0000-4000-8000-0000000000f1', tour_id: '10000000-0000-4000-8000-0000000000a2', client_id: CLIENT_A, depart_on: '2026-10-11', status: 'open' }),
      departureRow({ id: '20000000-0000-4000-8000-0000000000f2', tour_id: '99999999-0000-4000-8000-000000000000', client_id: CLIENT_A, depart_on: '2027-05-01', status: 'open' }),
    )

    const res = await optionsFor(CLIENT_A)
    const body = await jsonOf(res)
    const views = toursOf(body)
    const empty = tourById(views, '10000000-0000-4000-8000-0000000000a2')
    expect(empty).toBeDefined()
    expect(empty?.departures).toEqual([])
    expect(tourById(views, '10000000-0000-4000-8000-0000000000a3')).toBeUndefined()
    expect(JSON.stringify(body)).not.toContain('20000000-0000-4000-8000-0000000000f2')
  })

  it('scopes every catalog query to the client', async () => {
    await optionsFor(CLIENT_A)
    const catalogQueries = state().queries.filter(
      (q) => q.table === TOURS_TABLE || q.table === DEPARTURES_TABLE,
    )
    expect(catalogQueries.length).toBeGreaterThan(0)
    for (const query of catalogQueries) {
      const scoped = query.eqs.some(([col, val]) => col === 'client_id' && val === CLIENT_A)
      expect(scoped, `${query.table} not scoped to client`).toBe(true)
    }
  })
})

describe('GET options access gate', () => {
  it('is 401 without a session', async () => {
    signIn(null)
    const res = await optionsFor(CLIENT_A)
    expect(res.status).toBe(401)
  })

  it('refuses a signed-in user who is not a member and not an admin', async () => {
    signIn('stranger@a.test')
    const res = await optionsFor(CLIENT_A)
    expect([401, 403]).toContain(res.status)
  })

  it('allows a listed paid member', async () => {
    state().tables.client_portal_users.push({
      email: 'staff@a.test',
      client_id: CLIENT_A,
      access_type: 'dashboard',
      scoped_admin: false,
    })
    state().tables.crm_booking_members.push({
      client_id: CLIENT_A,
      email: 'staff@a.test',
      granted_by: 'admin@me.test',
    })
    signIn('staff@a.test')
    const res = await optionsFor(CLIENT_A)
    expect(res.status).toBe(200)
  })

  it('is 404 booking_tracker_not_enabled when the tracker is disabled', async () => {
    state().tables.clients = [{ id: CLIENT_A, leads_config: DISABLED_LEADS_CONFIG }]
    const res = await optionsFor(CLIENT_A)
    expect(res.status).toBe(404)
    expect(await jsonOf(res)).toEqual({ error: 'booking_tracker_not_enabled' })
  })

  it('is 400 invalid_id for a malformed client id', async () => {
    const res = await optionsFor('not-a-uuid')
    expect(res.status).toBe(400)
    expect(await jsonOf(res)).toEqual({ error: 'invalid_id' })
  })
})

describe('GET options uses the Pacific/Auckland date for "today"', () => {
  it('excludes a departure that is already past in New Zealand', async () => {
    vi.setSystemTime(new Date('2026-10-11T12:30:00Z'))
    state().tables[DEPARTURES_TABLE].push(
      departureRow({ id: '20000000-0000-4000-8000-0000000000d1', tour_id: TOUR_A1, client_id: CLIENT_A, depart_on: '2026-10-11', status: 'open' }),
    )
    const res = await optionsFor(CLIENT_A)
    const tours = toursOf(await jsonOf(res))
    const tourA = tourById(tours, TOUR_A1)
    const ids = (tourA?.departures ?? []).map((d) => d.id)
    expect(ids).not.toContain('20000000-0000-4000-8000-0000000000d1')
  })
})
