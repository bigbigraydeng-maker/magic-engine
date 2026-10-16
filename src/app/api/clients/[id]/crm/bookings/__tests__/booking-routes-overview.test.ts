import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FakeState, Row } from '@/lib/crm/__tests__/booking-fake-db'
import {
  CLIENT_A,
  CLIENT_B,
  TOUR_A1,
  DEP_A1,
  ENABLED_LEADS_CONFIG,
  bookingRow,
  contactRow,
  departureRow,
  tourRow,
  DEPARTURES_TABLE,
  TOURS_TABLE,
} from '@/lib/crm/__tests__/booking-fixtures'
import {
  bid,
  cid,
  depId,
  rowsOf,
  type BookingSpec,
} from '@/lib/crm/__tests__/booking-overview-fixtures'
import {
  ADMIN_EMAIL,
  jsonOf,
  params,
  request,
  setupAuthEnv,
} from './routes-support'

/**
 * End-to-end tests for the two NEW read-only overview routes.
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

import { GET as overviewGET } from '../overview/route'
import { GET as accessGET } from '../access/route'

function state(): FakeState {
  if (world.fake === null) throw new Error('fake db not initialised')
  return world.fake.state
}

function signIn(email: string | null): void {
  world.sessionEmail = email
}

function overviewFor(clientId: string, query = ''): Promise<Response> {
  return overviewGET(request('GET', undefined, query), params(clientId))
}

function accessFor(clientId: string): Promise<Response> {
  return accessGET(request('GET'), params(clientId))
}

interface OverviewGroup {
  key: string
  orders: number
  depositPaid: number
  balancePaid: number
  unsettled: number
}

interface OverviewSummary {
  groups: OverviewGroup[]
  totals: { orders: number }
  hiddenGroupCount: number
  notes: { cancelledOrders: number }
}

interface OverviewListRow {
  contactName: string | null
}

interface OverviewList {
  rows: OverviewListRow[]
  page: number
  pageCount: number
  total: number
}

interface PaidWithoutBooking {
  total: number
  rows: Array<{ id: string; name: string | null; stage: string }>
}

interface OverviewBody {
  summary: OverviewSummary
  hasBookings: boolean
  paidWithoutBooking: PaidWithoutBooking
  list: OverviewList
  today: string
}

function overviewOf(body: Record<string, unknown>): OverviewBody {
  return body as unknown as OverviewBody
}

function groupOf(body: OverviewBody, key: string): OverviewGroup | undefined {
  return body.summary.groups.find((g) => g.key === key)
}

/** Split rowsOf output into booking rows and milestone rows by shape. */
function seed(specs: BookingSpec[], clientId: string = CLIENT_A): void {
  for (const spec of specs) {
    for (const row of rowsOf(spec, clientId)) {
      if ('kind' in row) state().tables.crm_booking_milestones.push(row)
      else state().tables.crm_bookings.push(row)
    }
  }
}

function seedWorld(): void {
  state().tables = {
    clients: [
      { id: CLIENT_A, leads_config: ENABLED_LEADS_CONFIG },
      { id: CLIENT_B, leads_config: ENABLED_LEADS_CONFIG },
    ],
    client_portal_users: [],
    crm_booking_members: [],
    contacts: [],
    [TOURS_TABLE]: [tourRow({ id: TOUR_A1, client_id: CLIENT_A })],
    [DEPARTURES_TABLE]: [
      departureRow({ id: DEP_A1, tour_id: TOUR_A1, client_id: CLIENT_A }),
    ],
    crm_bookings: [],
    crm_booking_milestones: [],
  }
}

function spec(over: Partial<BookingSpec> & { n: number }): BookingSpec {
  return {
    departureId: DEP_A1,
    snapshot: '2027-03-12',
    contactN: over.n,
    ...over,
  }
}

beforeEach(() => {
  if (world.fake === null) throw new Error('fake db not initialised')
  world.fake.reset()
  setupAuthEnv()
  seedWorld()
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

describe('GET overview', () => {
  function seedHappyContacts(): void {
    const names = ['Ana', 'Ben', 'Cy', 'Di']
    names.forEach((name, i) => {
      state().tables.contacts.push(
        contactRow({ id: cid(i + 1), client_id: CLIENT_A, display_name: name }),
      )
    })
  }

  function seedHappyBookings(): void {
    seed([
      spec({ n: 1, deposit: { state: 'paid' }, balance: { due: '2027-01-01' } }),
      spec({ n: 2, deposit: { state: 'paid' }, balance: { state: 'paid' } }),
      spec({ n: 3, status: 'cancelled' }),
      spec({ n: 4, departureId: null, snapshot: null, bookedOn: '2026-10-01' }),
    ])
    seed(
      [spec({ n: 5, contactN: 5 })],
      CLIENT_B,
    )
  }

  it('returns the summary, list and paid-without-booking for a happy path', async () => {
    seedHappyContacts()
    seedHappyBookings()
    const res = await overviewFor(CLIENT_A)
    expect(res.status).toBe(200)
    const text = await res.clone().text()
    const body = overviewOf(await jsonOf(res))

    const depGroup = groupOf(body, DEP_A1)
    expect(depGroup).toBeDefined()
    expect(depGroup?.orders).toBe(2)
    expect(depGroup?.depositPaid).toBe(2)
    expect(depGroup?.balancePaid).toBe(1)
    expect(depGroup?.unsettled).toBe(1)

    const noneGroup = groupOf(body, 'none')
    expect(noneGroup).toBeDefined()
    expect(noneGroup?.orders).toBe(1)

    expect(body.summary.notes.cancelledOrders).toBe(1)
    expect(body.hasBookings).toBe(true)
    expect(body.list.total).toBe(3) // status all = active only (cancelled n3 excluded)

    const anaRow = body.list.rows.find((r) => r.contactName === 'Ana')
    expect(anaRow).toBeDefined()

    expect(text).not.toContain(bid(5))
    expect(res.headers.get('Server-Timing')).not.toBeNull()
  })

  it('never exposes money fields', async () => {
    seedHappyContacts()
    seedHappyBookings()
    const res = await overviewFor(CLIENT_A)
    const text = await res.clone().text()
    expect(text).not.toMatch(/amount|price|money|revenue/i)
  })

  it('returns an empty state when there are no bookings', async () => {
    const res = await overviewFor(CLIENT_A)
    expect(res.status).toBe(200)
    const body = overviewOf(await jsonOf(res))
    expect(body.hasBookings).toBe(false)
    expect(body.summary.groups).toEqual([])
    expect(body.summary.totals.orders).toBe(0)
    expect(body.list.rows).toEqual([])
    expect(body.paidWithoutBooking.total).toBe(0)
  })

  it('reports paid-without-booking contacts through the route', async () => {
    const stages = [
      'deposit_paid',
      'deposit_paid',
      'paid_full',
      'traveling_soon',
      'traveling_soon',
      'contacted',
      'paid_full',
    ]
    stages.forEach((stage, i) => {
      state().tables.contacts.push(
        contactRow({
          id: cid(i + 1),
          client_id: CLIENT_A,
          display_name: `C${i + 1}`,
          stage,
        }),
      )
    })
    // The last paid_full contact has only a cancelled booking, so it still counts.
    seed([spec({ n: 7, contactN: 7, status: 'cancelled' })])

    const res = await overviewFor(CLIENT_A)
    const body = overviewOf(await jsonOf(res))
    expect(body.paidWithoutBooking.total).toBe(5)
    expect(body.paidWithoutBooking.rows).toHaveLength(5)
  })

  it('honours status and departure filters', async () => {
    seed([
      spec({ n: 1, status: 'cancelled' }),
      spec({ n: 2, departureId: null, snapshot: null }),
      spec({ n: 3 }),
    ])

    const cancelled = overviewOf(await jsonOf(await overviewFor(CLIENT_A, '?status=cancelled')))
    expect(cancelled.list.rows).toHaveLength(1)

    const none = overviewOf(await jsonOf(await overviewFor(CLIENT_A, '?departureId=none')))
    expect(none.list.rows).toHaveLength(1)

    const dep = overviewOf(
      await jsonOf(await overviewFor(CLIENT_A, `?departureId=${DEP_A1}`)),
    )
    // status all = active only: the cancelled n1 is excluded, so only n3 shows for DEP_A1.
    expect(dep.list.rows).toHaveLength(1)

    const unsettled = overviewOf(
      await jsonOf(await overviewFor(CLIENT_A, '?status=unsettled')),
    )
    // n2 and n3 are active and unpaid; the cancelled n1 is excluded.
    expect(unsettled.list.rows).toHaveLength(2)
  })

  it('paginates and only asks for the names on the page', async () => {
    const specs: BookingSpec[] = []
    for (let i = 1; i <= 120; i++) specs.push(spec({ n: i }))
    seed(specs)

    const res = await overviewFor(CLIENT_A, '?page=2')
    const body = overviewOf(await jsonOf(res))
    expect(body.list.rows).toHaveLength(50)
    expect(body.list.page).toBe(2)
    expect(body.list.pageCount).toBe(3)
    expect(body.list.total).toBe(120)

    // Only the name lookup filters contacts by `id`; the paid-stage reader filters by `stage`.
    const contactQueries = state().queries.filter((q) => q.table === 'contacts')
    const totalIds = contactQueries.reduce(
      (sum, q) => sum + q.ins.reduce((s, [col, ids]) => s + (col === 'id' ? ids.length : 0), 0),
      0,
    )
    expect(totalIds).toBeLessThanOrEqual(50)
  })

  it('hides past paid groups unless includePastPaid is set', async () => {
    state().tables[DEPARTURES_TABLE].push(
      departureRow({
        id: depId(2),
        tour_id: TOUR_A1,
        client_id: CLIENT_A,
        depart_on: '2026-09-20',
        return_on: '2026-09-30',
      }),
    )
    seed([
      spec({
        n: 1,
        departureId: depId(2),
        snapshot: '2026-09-20',
        deposit: { state: 'paid' },
        balance: { state: 'paid' },
      }),
    ])

    const hidden = overviewOf(await jsonOf(await overviewFor(CLIENT_A)))
    expect(hidden.summary.hiddenGroupCount).toBe(1)
    expect(groupOf(hidden, depId(2))).toBeUndefined()

    const shown = overviewOf(
      await jsonOf(await overviewFor(CLIENT_A, '?includePastPaid=true')),
    )
    expect(groupOf(shown, depId(2))).toBeDefined()
    expect(shown.summary.hiddenGroupCount).toBe(0)
  })

  it('rejects bad query values without reading booking data', async () => {
    const cases: Array<[string, string]> = [
      ['?status=bogus', 'invalid_status'],
      ['?departureId=zzz', 'invalid_id'],
      ['?tourId=zzz', 'invalid_id'],
      ['?page=0', 'invalid_page'],
    ]
    for (const [query, error] of cases) {
      const res = await overviewFor(CLIENT_A, query)
      expect(res.status).toBe(400)
      expect(await jsonOf(res)).toEqual({ error })
    }
    expect(state().queries.some((q) => q.table === 'crm_bookings')).toBe(false)
  })

  it('never reads contact_touchpoints and always scopes by client', async () => {
    seedHappyContacts()
    seedHappyBookings()
    await overviewFor(CLIENT_A)

    expect(state().queries.some((q) => q.table === 'contact_touchpoints')).toBe(false)
    const scoped = state().queries.filter((q) =>
      ['crm_bookings', 'crm_booking_milestones', 'contacts'].includes(q.table),
    )
    for (const q of scoped) {
      expect(q.eqs).toContainEqual(['client_id', CLIENT_A])
    }
  })

  it('fails closed at the 20000-row ceiling', async () => {
    for (let i = 1; i <= 20000; i++) {
      state().tables.crm_bookings.push(
        bookingRow({ id: bid(i), client_id: CLIENT_A, contact_id: cid(1) }),
      )
    }
    const res = await overviewFor(CLIENT_A)
    expect(res.status).toBe(500)
    const body = await jsonOf(res)
    expect(body.error).toBe('booking_failed')
    expect(Object.keys(body)).toEqual(['error'])
  })

  it('fails closed when a reader errors', async () => {
    seed([spec({ n: 1 })])
    state().failTables.add('crm_booking_milestones')
    const res = await overviewFor(CLIENT_A)
    expect(res.status).toBe(500)
    const body = await jsonOf(res)
    expect(Object.keys(body)).toEqual(['error'])
  })

  it('returns 404 when the tracker is disabled', async () => {
    const client = state().tables.clients.find((c) => c.id === CLIENT_A)
    if (client === undefined) throw new Error('seeded client missing')
    client.leads_config = { booking_schedule: { enabled: false } }
    const res = await overviewFor(CLIENT_A)
    expect(res.status).toBe(404)
    expect(await jsonOf(res)).toEqual({ error: 'booking_tracker_not_enabled' })
  })
})

describe('GET access', () => {
  it('lets an admin through and reads only gate tables', async () => {
    const res = await accessFor(CLIENT_A)
    expect(res.status).toBe(200)
    expect(await jsonOf(res)).toEqual({ ok: true })
    for (const q of state().queries) {
      expect(q.table).toBe('clients')
    }
    expect(state().queries.some((q) => q.table === 'crm_bookings')).toBe(false)
    expect(state().queries.some((q) => q.table === 'crm_booking_milestones')).toBe(false)
    expect(state().queries.some((q) => q.table === 'contacts')).toBe(false)
  })

  it('refuses anonymous, non-member and disabled-tracker callers', async () => {
    signIn(null)
    const anon = await accessFor(CLIENT_A)
    expect(anon.status).toBe(401)
    expect(await jsonOf(anon)).not.toEqual({ ok: true })

    signIn('staff@a.test')
    state().tables.client_portal_users.push({
      email: 'staff@a.test',
      client_id: CLIENT_A,
      access_type: 'dashboard',
      scoped_admin: false,
    })
    const nonMember = await accessFor(CLIENT_A)
    expect(nonMember.status).toBe(403)
    expect(await jsonOf(nonMember)).not.toEqual({ ok: true })

    signIn(ADMIN_EMAIL)
    const client = state().tables.clients.find((c) => c.id === CLIENT_A)
    if (client === undefined) throw new Error('seeded client missing')
    client.leads_config = { booking_schedule: { enabled: false } }
    const disabled = await accessFor(CLIENT_A)
    expect(disabled.status).toBe(404)
    expect(await jsonOf(disabled)).not.toEqual({ ok: true })
  })
})

describe('GET overview, round 2 (S1, S3, S4, S5, S6)', () => {
  it('one unreadable booking row is a 500 with no numbers at all', async () => {
    seed([spec({ n: 1 }), spec({ n: 2 })])
    const bad = state().tables.crm_bookings[0]
    bad.status = 'not-a-status'
    const res = await overviewFor(CLIENT_A)
    expect(res.status).toBe(500)
    expect(Object.keys(await jsonOf(res))).toEqual(['error'])
  })

  it('a booking with a missing milestone is a 500 with no numbers', async () => {
    seed([spec({ n: 1 }), spec({ n: 2 })])
    state().tables.crm_booking_milestones = state().tables.crm_booking_milestones.slice(1)
    const res = await overviewFor(CLIENT_A)
    expect(res.status).toBe(500)
    expect(Object.keys(await jsonOf(res))).toEqual(['error'])
  })

  it('the summary carries the new hidden counts and groups carry the new flags', async () => {
    seed([spec({ n: 1, deposit: { state: 'paid' }, balance: { due: '2027-01-01' } })])
    const body = await jsonOf(await overviewFor(CLIENT_A))
    const summary = body.summary as Record<string, unknown>
    expect(summary.hiddenOrders).toBe(0)
    expect(summary.hiddenOfflineOnlyGroups).toBe(0)
    const group = (summary.groups as Array<Record<string, unknown>>)[0]
    expect(group.dateAmbiguous).toBe(false)
    expect(group.openItems).toBe(1)
  })

  it('status=offline is accepted; status=all excludes cancelled; status=cancelled shows them', async () => {
    seed([
      spec({ n: 1, deposit: { state: 'paid' }, balance: { quiet: true, due: '2027-01-01' } }),
      spec({ n: 2, status: 'cancelled' }),
      spec({ n: 3, deposit: { state: 'paid' }, balance: { due: '2027-01-01' } }),
    ])
    const rowsFor = async (query: string): Promise<number> =>
      overviewOf(await jsonOf(await overviewFor(CLIENT_A, query))).list.rows.length
    expect(await rowsFor('?status=offline')).toBe(1)
    expect(await rowsFor('?status=all')).toBe(2)
    expect(await rowsFor('?status=cancelled')).toBe(1)
  })
})
