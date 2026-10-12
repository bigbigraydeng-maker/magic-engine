import { beforeEach, describe, expect, it } from 'vitest'
import { vi } from 'vitest'

/**
 * The gate's independent lookups (member list / booking config) start in the same tick,
 * while the DECISIONS keep their original order. Every failure combination is pinned.
 */

const CLIENT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ENABLED = {
  booking_schedule: {
    enabled: true,
    deposit_due_working_days: 3,
    balance_lead_days: { standard: 90, long_or_cruise: 120 },
    long_tour_min_days: 16,
    holiday_region: 'NZ',
    balance_roll_forward: false,
  },
}

type MemberOutcome = 'member' | 'not_member' | 'fail' | 'throw'
type ConfigOutcome = 'ready' | 'disabled' | 'fail' | 'throw'

const world = vi.hoisted(() => ({
  role: 'client-viewer',
  allowedClientId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' as string | null,
  member: 'member',
  config: 'ready',
  started: [] as string[],
  finished: [] as string[],
  enabledConfig: null as unknown,
}))

vi.mock('@/lib/auth/client-access', () => ({
  requirePaidClientAccess: async () => ({
    ok: true,
    user: { email: 'Staff@A.test' },
    role: world.role,
    tier: 'paid_client',
    allowedClientId: world.allowedClientId,
  }),
}))

function resolveLater<T>(table: string, make: () => T): Promise<T> {
  world.started.push(table)
  return new Promise<T>((resolve, reject) => {
    // Resolve on a later macrotask so a sequential implementation cannot start the
    // second query until the first one has fully finished.
    setTimeout(() => {
      world.finished.push(table)
      try {
        resolve(make())
      } catch (err) {
        reject(err)
      }
    }, 5)
  })
}

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const chain: Record<string, unknown> = {}
      const run = () =>
        resolveLater(table, () => {
          if (table === 'crm_booking_members') {
            if (world.member === 'throw') throw new Error('boom')
            if (world.member === 'fail') return { data: null, error: { message: 'x' } }
            return { data: world.member === 'member' ? [{ email: 'staff@a.test' }] : [], error: null }
          }
          if (world.config === 'throw') throw new Error('boom')
          if (world.config === 'fail') return { data: null, error: { message: 'x' } }
          return {
            data: {
              leads_config: world.config === 'ready' ? world.enabledConfig : { booking_schedule: { enabled: false } },
            },
            error: null,
          }
        })
      for (const m of ['select', 'eq', 'limit']) chain[m] = () => chain
      chain.maybeSingle = run
      chain.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => run().then(res, rej)
      return chain
    },
  },
}))

import { requireBookingAccess } from '../booking-access'

async function call(capability: 'view' | 'edit' | 'manage_members') {
  const access = await requireBookingAccess(CLIENT, capability)
  if (access.ok) return { ok: true as const, role: access.role }
  return { ok: false as const, status: access.response.status, body: await access.response.json() }
}

beforeEach(() => {
  world.role = 'client-viewer'
  world.allowedClientId = CLIENT
  world.member = 'member'
  world.config = 'ready'
  world.started = []
  world.finished = []
  world.enabledConfig = ENABLED
})

describe('requireBookingAccess concurrency', () => {
  it('starts the member lookup and the config load before either has finished', async () => {
    const pending = call('view')
    await Promise.resolve()
    await Promise.resolve()
    expect(world.finished).toEqual([])
    expect([...world.started].sort()).toEqual(['clients', 'crm_booking_members'])
    expect(await pending).toEqual({ ok: true, role: 'member' })
  })

  it('a global admin runs only the config load', async () => {
    world.role = 'admin'
    world.allowedClientId = null
    expect(await call('view')).toEqual({ ok: true, role: 'me_admin' })
    expect(world.started).toEqual(['clients'])
  })

  it('manage_members for the global admin reads nothing', async () => {
    world.role = 'admin'
    world.allowedClientId = null
    expect(await call('manage_members')).toEqual({ ok: true, role: 'me_admin' })
    expect(world.started).toEqual([])
  })

  it('a listed member asking for manage_members is 403 and the config is never read', async () => {
    expect(await call('manage_members')).toMatchObject({ ok: false, status: 403 })
    expect(world.started).toEqual(['crm_booking_members'])
  })

  const MEMBERS: MemberOutcome[] = ['member', 'not_member', 'fail', 'throw']
  const CONFIGS: ConfigOutcome[] = ['ready', 'disabled', 'fail', 'throw']
  // Decision order of the gate: member 500 → member 403 → config 500 → config 404 → ok.
  function expected(m: MemberOutcome, c: ConfigOutcome) {
    if (m === 'fail' || m === 'throw') return { status: 500, error: 'Authorization check failed' }
    if (m === 'not_member') return { status: 403, error: 'Forbidden' }
    if (c === 'fail' || c === 'throw') return { status: 500, error: 'Authorization check failed' }
    if (c === 'disabled') return { status: 404, error: 'booking_tracker_not_enabled' }
    return null
  }

  for (const m of MEMBERS) {
    for (const c of CONFIGS) {
      it(`member=${m} config=${c} keeps the original winning status`, async () => {
        world.member = m
        world.config = c
        const result = await call('view')
        const want = expected(m, c)
        if (want === null) {
          expect(result).toEqual({ ok: true, role: 'member' })
        } else {
          expect(result).toMatchObject({ ok: false, status: want.status, body: { error: want.error } })
        }
      })
    }
  }

  for (const c of CONFIGS) {
    it(`global admin with config=${c}`, async () => {
      world.role = 'admin'
      world.allowedClientId = null
      world.config = c
      const result = await call('edit')
      const want = expected('member', c)
      if (want === null) expect(result).toEqual({ ok: true, role: 'me_admin' })
      else expect(result).toMatchObject({ ok: false, status: want.status, body: { error: want.error } })
    })
  }
})
