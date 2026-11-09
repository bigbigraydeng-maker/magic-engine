import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import type { FakeState } from './booking-fake-db'

/**
 * Guard rail: no environment variable may ever switch the CRM booking gate off.
 *
 * A local-only bypass that gets committed by mistake must turn this red. This mirrors the
 * idea of the tour-catalog guard in src/lib/tour-catalog/__tests__/access.test.ts, but it
 * exercises the REAL requireBookingAccess against the table-shaped fake database.
 */

const CLIENT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

const ENABLED_LEADS_CONFIG: Record<string, unknown> = {
  booking_schedule: {
    enabled: true,
    deposit_due_working_days: 3,
    balance_lead_days: { standard: 90, long_or_cruise: 120 },
    long_tour_min_days: 16,
    holiday_region: 'NZ',
    balance_roll_forward: false,
  },
}

const PORTAL_USERS_TABLE = 'client_portal_users'
const MEMBERS_TABLE = 'crm_booking_members'
const CLIENTS_TABLE = 'clients'

type Row = Record<string, unknown>

const world = vi.hoisted(() => ({
  sessionEmail: null as string | null,
  fake: null as { state: FakeState; reset: () => void } | null,
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
  return { supabaseAdmin: fake.db }
})

import { requireBookingAccess } from '../booking-access'

type Capability = 'view' | 'edit' | 'manage_members'

const CAPABILITIES: Capability[] = ['view', 'edit', 'manage_members']

interface EnvVariant {
  ROLE?: string
  EMAIL?: string
}

const ENV_VARIANTS: EnvVariant[] = [
  {},
  { ROLE: 'admin' },
  { ROLE: 'member' },
  { ROLE: 'nonmember' },
  { ROLE: 'admin', EMAIL: 'someone@test.local' },
]

function portalUser(email: string, clientId: string, accessType: string, scopedAdmin = false): Row {
  return { email, client_id: clientId, access_type: accessType, scoped_admin: scopedAdmin }
}

function signIn(email: string | null): void {
  world.sessionEmail = email
}

function state(): FakeState {
  if (world.fake === null) throw new Error('fake db not initialised')
  return world.fake.state
}

function applyEnv(env: EnvVariant): void {
  process.env.BOOKING_LOCAL_TEST = '1'
  delete process.env.BOOKING_LOCAL_ROLE
  delete process.env.BOOKING_LOCAL_EMAIL
  if (env.ROLE !== undefined) process.env.BOOKING_LOCAL_ROLE = env.ROLE
  if (env.EMAIL !== undefined) process.env.BOOKING_LOCAL_EMAIL = env.EMAIL
}

beforeEach(() => {
  if (world.fake === null) throw new Error('fake db not initialised')
  world.fake.reset()
  state().tables[CLIENTS_TABLE] = [{ id: CLIENT_A, leads_config: ENABLED_LEADS_CONFIG }]
  state().tables[PORTAL_USERS_TABLE] = []
  state().tables[MEMBERS_TABLE] = []
  process.env.ADMIN_EMAILS = 'admin@me.test'
  delete process.env.BOOKING_LOCAL_TEST
  delete process.env.BOOKING_LOCAL_ROLE
  delete process.env.BOOKING_LOCAL_EMAIL
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'info').mockImplementation(() => {})
})

afterEach(() => {
  delete process.env.BOOKING_LOCAL_TEST
  delete process.env.BOOKING_LOCAL_ROLE
  delete process.env.BOOKING_LOCAL_EMAIL
  vi.restoreAllMocks()
})

describe('requireBookingAccess ignores local-test environment flags', () => {
  it.each(ENV_VARIANTS)(
    'still rejects a logged-out caller when BOOKING_LOCAL_TEST=1 (env %j)',
    async (env) => {
      applyEnv(env)
      signIn(null)
      for (const capability of CAPABILITIES) {
        const result = await requireBookingAccess(CLIENT_A, capability)
        expect(result.ok, `${capability} ${JSON.stringify(env)}`).toBe(false)
        if (result.ok) throw new Error('expected failure')
        expect(result.response.status, `${capability} ${JSON.stringify(env)}`).toBe(401)
      }
    },
  )

  it.each(ENV_VARIANTS)(
    'still rejects an unlisted paid member when BOOKING_LOCAL_TEST=1 (env %j)',
    async (env) => {
      applyEnv(env)
      state().tables[PORTAL_USERS_TABLE].push(portalUser('staff@a.test', CLIENT_A, 'dashboard'))
      signIn('staff@a.test')
      for (const capability of CAPABILITIES) {
        const result = await requireBookingAccess(CLIENT_A, capability)
        expect(result.ok, `${capability} ${JSON.stringify(env)}`).toBe(false)
        if (result.ok) throw new Error('expected failure')
        expect(result.response.status, `${capability} ${JSON.stringify(env)}`).toBe(403)
      }
    },
  )

  it('control: with the env flags unset, a global admin passes view', async () => {
    signIn('admin@me.test')
    const result = await requireBookingAccess(CLIENT_A, 'view')
    expect(result.ok).toBe(true)
  })
})
