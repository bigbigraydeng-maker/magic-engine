import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FakeState } from '@/lib/crm/__tests__/booking-fake-db'
import { CLIENT_A, CONTACT_A1, DEPARTURES_TABLE, TOURS_TABLE } from '@/lib/crm/__tests__/booking-fixtures'
import { ADMIN_EMAIL, params, request, seedStandardWorld, setupAuthEnv } from './routes-support'

/**
 * Speed of the booking GET paths, measured structurally.
 *
 * Every database query is delayed by a timer and logged with the "depth" at which it
 * started: depth = 1 + the deepest query that had already FINISHED when it started.
 * The largest depth is the number of sequential database round trips on the path.
 * (Before this change every query was awaited in turn, so depth == number of queries.)
 */

interface Logged {
  table: string
  depth: number
}

const world = vi.hoisted(() => ({
  sessionEmail: null as string | null,
  fake: null as { state: FakeState; reset: () => void } | null,
  log: [] as Array<{ table: string; depth: number }>,
  finishedDepths: [] as number[],
}))

vi.mock('@/lib/supabase-server', () => ({
  createServerSupabaseClient: () => ({
    auth: {
      getUser: async () => ({
        data: { user: world.sessionEmail === null ? null : { id: 'user-1', email: world.sessionEmail } },
      }),
    },
  }),
}))

vi.mock('@/lib/supabase', async () => {
  const mod = await import('@/lib/crm/__tests__/booking-fake-db')
  const fake = mod.createFakeDb()
  world.fake = { state: fake.state, reset: fake.reset }

  function slow(builder: Record<string | symbol, unknown>, table: string): unknown {
    const proxy: unknown = new Proxy(builder, {
      get(target, prop) {
        if (prop === 'then') {
          return (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => {
            const depth = 1 + Math.max(0, ...world.finishedDepths)
            world.log.push({ table, depth })
            return new Promise<void>((r) => setTimeout(r, 4)).then(() => {
              world.finishedDepths.push(depth)
              return (target.then as (a: unknown, b: unknown) => unknown)(res, rej)
            })
          }
        }
        const value = target[prop]
        if (typeof value !== 'function') return value
        return (...args: unknown[]) => {
          const out = (value as (...a: unknown[]) => unknown).apply(target, args)
          return out === target ? proxy : out
        }
      },
    })
    return proxy
  }

  const realFrom = fake.db.from.bind(fake.db)
  const db = new Proxy(fake.db, {
    get(target, prop) {
      if (prop === 'from') {
        return (table: string) => slow(realFrom(table) as unknown as Record<string | symbol, unknown>, table)
      }
      return (target as unknown as Record<string | symbol, unknown>)[prop]
    },
  })
  return { supabaseAdmin: db }
})

import { GET as bookingsGET } from '../route'
import { GET as nudgeListGET } from '../nudge-list/route'

function state(): FakeState {
  if (world.fake === null) throw new Error('fake db not initialised')
  return world.fake.state
}

function depthOf(log: Logged[]): number {
  return Math.max(0, ...log.map((q) => q.depth))
}

const MEMBER = 'staff@a.test'

beforeEach(() => {
  setupAuthEnv()
  world.fake?.reset()
  seedStandardWorld(state())
  world.log = []
  world.finishedDepths = []
})

describe('booking GET speed', () => {
  it('admin: list for a contact is 4 sequential round trips (was 6 queries in a row)', async () => {
    world.sessionEmail = ADMIN_EMAIL
    const res = await bookingsGET(request('GET', undefined, `?contactId=${CONTACT_A1}`), params(CLIENT_A))
    expect(res.status).toBe(200)
    expect(world.log.length).toBe(6)
    expect(depthOf(world.log)).toBe(4)
    const at = (depth: number) => world.log.filter((q) => q.depth === depth).map((q) => q.table).sort()
    expect(at(1)).toEqual(['clients'])
    expect(at(2)).toEqual(['contacts', 'crm_bookings'])
    expect(at(3)).toEqual(['crm_booking_milestones'])
    expect(at(4)).toEqual([DEPARTURES_TABLE, TOURS_TABLE])
  })

  it('listed member: 5 sequential round trips (was 8 queries in a row)', async () => {
    world.sessionEmail = MEMBER
    state().tables.client_portal_users = [
      { email: MEMBER, client_id: CLIENT_A, access_type: 'dashboard', scoped_admin: false },
    ]
    state().tables.crm_booking_members = [{ client_id: CLIENT_A, email: MEMBER }]
    const res = await bookingsGET(request('GET', undefined, `?contactId=${CONTACT_A1}`), params(CLIENT_A))
    expect(res.status).toBe(200)
    expect(world.log.length).toBe(8)
    expect(depthOf(world.log)).toBe(5)
    const at = (depth: number) => world.log.filter((q) => q.depth === depth).map((q) => q.table).sort()
    expect(at(2)).toEqual(['clients', 'crm_booking_members'])
  })

  it('nudge list: at most 4 sequential round trips and answers 200', async () => {
    world.sessionEmail = ADMIN_EMAIL
    const res = await nudgeListGET(request('GET'), params(CLIENT_A))
    expect(res.status).toBe(200)
    // clients → milestones → bookings → (contacts ‖ touchpoints ‖ tours ‖ departures)
    expect(world.log.length).toBeGreaterThanOrEqual(5)
    expect(depthOf(world.log)).toBeLessThanOrEqual(4)
  })

  it('sends a Server-Timing header with only gate and total durations', async () => {
    world.sessionEmail = ADMIN_EMAIL
    const list = await bookingsGET(request('GET', undefined, `?contactId=${CONTACT_A1}`), params(CLIENT_A))
    const nudge = await nudgeListGET(request('GET'), params(CLIENT_A))
    for (const res of [list, nudge]) {
      const header = res.headers.get('Server-Timing') ?? ''
      expect(header).toMatch(/^gate;dur=\d+(\.\d+)?, total;dur=\d+(\.\d+)?$/)
      expect(header).not.toContain(CLIENT_A)
    }
  })

  it('a contact of another client is still a 404 (ownership decides first)', async () => {
    world.sessionEmail = ADMIN_EMAIL
    const res = await bookingsGET(
      request('GET', undefined, '?contactId=c1b1b1b1-0000-4000-8000-0000000000b1'),
      params(CLIENT_A),
    )
    expect(res.status).toBe(404)
  })

  it('not-this-client contact stays 404 even when the bookings read fails; own contact then is 500', async () => {
    world.sessionEmail = ADMIN_EMAIL
    state().failTables.add('crm_bookings')
    const other = await bookingsGET(
      request('GET', undefined, '?contactId=c1b1b1b1-0000-4000-8000-0000000000b1'),
      params(CLIENT_A),
    )
    expect(other.status).toBe(404)
    const own = await bookingsGET(request('GET', undefined, `?contactId=${CONTACT_A1}`), params(CLIENT_A))
    expect(own.status).toBe(500)
  })
})
