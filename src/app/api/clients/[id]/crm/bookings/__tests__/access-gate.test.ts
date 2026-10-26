import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { FakeState } from '@/lib/crm/__tests__/booking-fake-db'

/**
 * Who can reach the CRM booking-tracker routes (design §11).
 *
 * Nothing in the access path is mocked: the REAL requirePaidClientAccess and the REAL
 * requireBookingAccess run. Only the sign-in session and the database client are replaced.
 * The database is a table-shaped fake, so "nothing else was touched" is measured at the
 * only door the gate has: every recorded query's table must be one of the gate's own lookups.
 */

const CLIENT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const CLIENT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const CONTACT_A1 = 'c1a1a1a1-0000-4000-8000-000000000001'
const TOUR_A1 = '10000000-0000-4000-8000-0000000000a1'
const BOOKING_A1 = '30000000-0000-4000-8000-0000000000a1'
const UPDATED_AT = '2026-10-01T00:00:00.000000+00:00'

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

const DISABLED_LEADS_CONFIG: Record<string, unknown> = {
  booking_schedule: { enabled: false },
}

const PORTAL_USERS_TABLE = 'client_portal_users'
const MEMBERS_TABLE = 'crm_booking_members'
const CLIENTS_TABLE = 'clients'
const CONTACTS_TABLE = 'contacts'
const GATE_TABLES = new Set([PORTAL_USERS_TABLE, MEMBERS_TABLE, CLIENTS_TABLE])

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

import { GET as bookingsGET, POST as bookingsPOST } from '../route'
import { PATCH as bookingPATCH } from '../[bookingId]/route'
import { POST as confirmPOST } from '../[bookingId]/confirm-departure/route'
import { POST as cancelPOST } from '../[bookingId]/cancel/route'
import { POST as paidPOST } from '../[bookingId]/milestones/[kind]/paid/route'
import { POST as unpaidPOST } from '../[bookingId]/milestones/[kind]/unpaid/route'
import { POST as overridePOST } from '../[bookingId]/milestones/[kind]/override-due/route'
import { POST as nudgePOST } from '../[bookingId]/milestones/[kind]/nudge/route'
import { GET as nudgeListGET } from '../nudge-list/route'
import { GET as optionsGET } from '../options/route'
import { GET as overviewGET } from '../overview/route'
import { GET as accessGET } from '../access/route'
import { GET as membersGET, POST as membersPOST, DELETE as membersDELETE } from '../members/route'

type Capability = 'view' | 'edit' | 'manage_members'

function request(method: string, body?: unknown, query = ''): NextRequest {
  return new NextRequest(`http://localhost/api/clients/x/crm/bookings${query}`, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
  })
}

interface HandlerCase {
  name: string
  capability: Capability
  call: (clientId: string) => Promise<Response>
}

const p = (clientId: string) => ({
  params: Promise.resolve({ id: clientId, bookingId: BOOKING_A1, kind: 'balance' }),
})

const HANDLERS: HandlerCase[] = [
  { name: 'GET bookings', capability: 'view', call: (c) => bookingsGET(request('GET', undefined, `?contactId=${CONTACT_A1}`), p(c)) },
  {
    name: 'POST bookings',
    capability: 'edit',
    call: (c) => bookingsPOST(request('POST', { contactId: CONTACT_A1, tourId: TOUR_A1 }), p(c)),
  },
  {
    name: 'PATCH booking',
    capability: 'edit',
    call: (c) => bookingPATCH(request('PATCH', { expectedUpdatedAt: UPDATED_AT, patch: { note: 'x' } }), p(c)),
  },
  {
    name: 'POST confirm-departure',
    capability: 'edit',
    call: (c) => confirmPOST(request('POST', { expectedUpdatedAt: UPDATED_AT }), p(c)),
  },
  {
    name: 'POST cancel',
    capability: 'edit',
    call: (c) => cancelPOST(request('POST', { expectedUpdatedAt: UPDATED_AT, cancelNote: 'changed plans' }), p(c)),
  },
  {
    name: 'POST paid',
    capability: 'edit',
    call: (c) => paidPOST(request('POST', { expectedUpdatedAt: UPDATED_AT }), p(c)),
  },
  {
    name: 'POST unpaid',
    capability: 'edit',
    call: (c) => unpaidPOST(request('POST', { expectedUpdatedAt: UPDATED_AT }), p(c)),
  },
  {
    name: 'POST override-due',
    capability: 'edit',
    call: (c) => overridePOST(request('POST', { expectedUpdatedAt: UPDATED_AT, dueOn: null }), p(c)),
  },
  {
    name: 'POST nudge',
    capability: 'edit',
    call: (c) => nudgePOST(request('POST', { expectedUpdatedAt: UPDATED_AT, mode: 'quiet' }), p(c)),
  },
  { name: 'GET nudge-list', capability: 'view', call: (c) => nudgeListGET(request('GET'), p(c)) },
  { name: 'GET options', capability: 'view', call: (c) => optionsGET(request('GET'), p(c)) },
  { name: 'GET overview', capability: 'view', call: (c) => overviewGET(request('GET'), p(c)) },
  { name: 'GET access', capability: 'view', call: (c) => accessGET(request('GET'), p(c)) },
  { name: 'GET members', capability: 'manage_members', call: (c) => membersGET(request('GET'), p(c)) },
  { name: 'POST members', capability: 'manage_members', call: (c) => membersPOST(request('POST', { email: 'new@a.test' }), p(c)) },
  {
    name: 'DELETE members',
    capability: 'manage_members',
    call: (c) => membersDELETE(request('DELETE', undefined, '?email=old@a.test'), p(c)),
  },
]

const VIEW_EDIT = HANDLERS.filter((h) => h.capability === 'view' || h.capability === 'edit')
const MANAGE_MEMBERS = HANDLERS.filter((h) => h.capability === 'manage_members')

function portalUser(email: string, clientId: string, accessType: string, scopedAdmin = false): Row {
  return { email, client_id: clientId, access_type: accessType, scoped_admin: scopedAdmin }
}

function listed(email: string, clientId: string): Row {
  return { client_id: clientId, email, granted_by: 'admin@me.test', created_at: UPDATED_AT }
}

function signIn(email: string | null): void {
  world.sessionEmail = email
}

function state(): FakeState {
  if (world.fake === null) throw new Error('fake db not initialised')
  return world.fake.state
}

function seedClient(clientId: string, leadsConfig: unknown): void {
  state().tables[CLIENTS_TABLE] = state().tables[CLIENTS_TABLE] ?? []
  state().tables[CLIENTS_TABLE].push({ id: clientId, leads_config: leadsConfig })
}

/** The response is NOT a gate denial: not 401/403, not the disabled 404, not the lookup-failure 500. */
async function passedGate(res: Response): Promise<boolean> {
  if (res.status === 401 || res.status === 403) return false
  if (res.status === 404) {
    const body = (await res.json()) as { error?: string }
    if (body.error === 'booking_tracker_not_enabled') return false
  }
  if (res.status === 500) {
    const body = (await res.json()) as { error?: string }
    if (body.error === 'Authorization check failed') return false
  }
  return true
}

async function expectDenied(handler: HandlerCase, clientId: string, status: number): Promise<void> {
  const res = await handler.call(clientId)
  expect(res.status, handler.name).toBe(status)
  expect(state().rpcCalls, `${handler.name} called an rpc`).toEqual([])
  for (const query of state().queries) {
    expect(GATE_TABLES.has(query.table), `${handler.name} touched ${query.table}`).toBe(true)
  }
}

beforeEach(() => {
  if (world.fake === null) throw new Error('fake db not initialised')
  world.fake.reset()
  state().tables[PORTAL_USERS_TABLE] = []
  state().tables[MEMBERS_TABLE] = []
  state().tables[CONTACTS_TABLE] = []
  seedClient(CLIENT_A, ENABLED_LEADS_CONFIG)
  seedClient(CLIENT_B, ENABLED_LEADS_CONFIG)
  process.env.ADMIN_EMAILS = 'admin@me.test'
  process.env.DEMO_ADMINS = `demo@me.test:${CLIENT_A}`
  process.env.CLIENT_VIEWERS = `envviewer@a.test:${CLIENT_A}`
  delete process.env.ADMIN_EMAIL_DOMAIN
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'info').mockImplementation(() => {})
})

describe('the matrix covers every handler', () => {
  it('has one case per registered handler', () => {
    expect(HANDLERS).toHaveLength(16)
    expect(VIEW_EDIT.length + MANAGE_MEMBERS.length).toBe(HANDLERS.length)
  })
})

describe.each(HANDLERS)('$name', (handler) => {
  it('not signed in → 401, nothing touched', async () => {
    signIn(null)
    await expectDenied(handler, CLIENT_A, 401)
  })

  it('a listed paid member of client B asking for client A → 403', async () => {
    state().tables[PORTAL_USERS_TABLE].push(portalUser('staff@b.test', CLIENT_B, 'dashboard'))
    state().tables[MEMBERS_TABLE].push(listed('staff@b.test', CLIENT_B))
    signIn('staff@b.test')
    await expectDenied(handler, CLIENT_A, 403)
  })

  it('self_serve member, even when on the list → 403', async () => {
    state().tables[PORTAL_USERS_TABLE].push(portalUser('free@a.test', CLIENT_A, 'self_serve'))
    state().tables[MEMBERS_TABLE].push(listed('free@a.test', CLIENT_A))
    signIn('free@a.test')
    await expectDenied(handler, CLIENT_A, 403)
  })

  it('portal-only member, even when on the list → 403', async () => {
    state().tables[PORTAL_USERS_TABLE].push(portalUser('portal@a.test', CLIENT_A, 'portal'))
    state().tables[MEMBERS_TABLE].push(listed('portal@a.test', CLIENT_A))
    signIn('portal@a.test')
    await expectDenied(handler, CLIENT_A, 403)
  })

  it('paid member who is not on the list → 403', async () => {
    state().tables[PORTAL_USERS_TABLE].push(portalUser('staff@a.test', CLIENT_A, 'dashboard'))
    signIn('staff@a.test')
    await expectDenied(handler, CLIENT_A, 403)
  })

  it('env-configured viewer and restricted demo admin who are not on the list → 403', async () => {
    signIn('envviewer@a.test')
    await expectDenied(handler, CLIENT_A, 403)
    signIn('demo@me.test')
    await expectDenied(handler, CLIENT_A, 403)
  })

  it('a listed paid member of client A: view/edit pass the gate, manage_members is refused', async () => {
    state().tables[PORTAL_USERS_TABLE].push(portalUser('staff@a.test', CLIENT_A, 'dashboard'))
    state().tables[MEMBERS_TABLE].push(listed('staff@a.test', CLIENT_A))
    signIn('staff@a.test')
    if (handler.capability === 'manage_members') {
      await expectDenied(handler, CLIENT_A, 403)
    } else {
      const res = await handler.call(CLIENT_A)
      expect(await passedGate(res), handler.name).toBe(true)
    }
  })

  it('global admin passes the gate for every handler', async () => {
    signIn('admin@me.test')
    const res = await handler.call(CLIENT_A)
    expect(await passedGate(res), handler.name).toBe(true)
  })

  it('disabled client, listed member: view/edit → 404 booking_tracker_not_enabled; manage_members → 403', async () => {
    state().tables[CLIENTS_TABLE] = [{ id: CLIENT_A, leads_config: DISABLED_LEADS_CONFIG }]
    state().tables[PORTAL_USERS_TABLE].push(portalUser('staff@a.test', CLIENT_A, 'dashboard'))
    state().tables[MEMBERS_TABLE].push(listed('staff@a.test', CLIENT_A))
    signIn('staff@a.test')
    if (handler.capability === 'manage_members') {
      const res = await handler.call(CLIENT_A)
      expect(res.status, handler.name).toBe(403)
    } else {
      const res = await handler.call(CLIENT_A)
      expect(res.status, handler.name).toBe(404)
      expect(((await res.json()) as { error: string }).error).toBe('booking_tracker_not_enabled')
    }
  })

  it('disabled client, global admin: manage_members still passes the gate', async () => {
    if (handler.capability !== 'manage_members') return
    state().tables[CLIENTS_TABLE] = [{ id: CLIENT_A, leads_config: DISABLED_LEADS_CONFIG }]
    signIn('admin@me.test')
    const res = await handler.call(CLIENT_A)
    expect(await passedGate(res), handler.name).toBe(true)
  })

  it('invalid client id → 400 invalid_id, nothing touched', async () => {
    signIn('admin@me.test')
    const res = await handler.call('not-a-uuid')
    expect(res.status, handler.name).toBe(400)
    expect(((await res.json()) as { error: string }).error).toBe('invalid_id')
    expect(state().queries, `${handler.name} touched the database`).toEqual([])
  })
})

describe('the disabled client also blocks the global admin on view/edit', () => {
  it.each(VIEW_EDIT)('$name → 404 booking_tracker_not_enabled', async (handler) => {
    state().tables[CLIENTS_TABLE] = [{ id: CLIENT_A, leads_config: DISABLED_LEADS_CONFIG }]
    signIn('admin@me.test')
    const res = await handler.call(CLIENT_A)
    expect(res.status).toBe(404)
    expect(((await res.json()) as { error: string }).error).toBe('booking_tracker_not_enabled')
  })
})

describe('a missing or invalid booking_schedule config fails closed', () => {
  it.each([
    ['no booking_schedule key', {}],
    ['invalid booking_schedule', { booking_schedule: { enabled: true } }],
  ])('%s → 404 for the admin on GET bookings', async (_label, leadsConfig) => {
    state().tables[CLIENTS_TABLE] = [{ id: CLIENT_A, leads_config: leadsConfig }]
    signIn('admin@me.test')
    const res = await bookingsGET(request('GET', undefined, `?contactId=${CONTACT_A1}`), p(CLIENT_A))
    expect(res.status).toBe(404)
    expect(((await res.json()) as { error: string }).error).toBe('booking_tracker_not_enabled')
  })
})

describe('lookup failures fail closed', () => {
  it('a member-table failure is a 500, never a pass', async () => {
    state().tables[PORTAL_USERS_TABLE].push(portalUser('staff@a.test', CLIENT_A, 'dashboard'))
    state().failTables.add(MEMBERS_TABLE)
    signIn('staff@a.test')
    const res = await bookingsGET(request('GET', undefined, `?contactId=${CONTACT_A1}`), p(CLIENT_A))
    expect(res.status).toBe(500)
    expect(((await res.json()) as { error: string }).error).toBe('Authorization check failed')
  })

  it('a clients-table failure is a 500 for the admin on a view handler', async () => {
    state().failTables.add(CLIENTS_TABLE)
    signIn('admin@me.test')
    const res = await bookingsGET(request('GET', undefined, `?contactId=${CONTACT_A1}`), p(CLIENT_A))
    expect(res.status).toBe(500)
    expect(((await res.json()) as { error: string }).error).toBe('Authorization check failed')
  })
})

describe('email case', () => {
  it('a mixed-case session email matches lower-cased portal and list rows', async () => {
    state().tables[PORTAL_USERS_TABLE].push(portalUser('staff@a.test', CLIENT_A, 'dashboard'))
    state().tables[MEMBERS_TABLE].push(listed('staff@a.test', CLIENT_A))
    signIn('Staff@A.test')
    const res = await bookingsGET(request('GET', undefined, `?contactId=${CONTACT_A1}`), p(CLIENT_A))
    expect(await passedGate(res)).toBe(true)
  })
})

describe('GET bookings end to end', () => {
  function seedContact(): void {
    state().tables[CONTACTS_TABLE] = [{ id: CONTACT_A1, client_id: CLIENT_A, display_name: 'Li Wei', do_not_contact: false }]
  }

  it('a listed member gets 200 with an empty booking list', async () => {
    seedContact()
    state().tables[PORTAL_USERS_TABLE].push(portalUser('staff@a.test', CLIENT_A, 'dashboard'))
    state().tables[MEMBERS_TABLE].push(listed('staff@a.test', CLIENT_A))
    signIn('staff@a.test')
    const res = await bookingsGET(request('GET', undefined, `?contactId=${CONTACT_A1}`), p(CLIENT_A))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ bookings: [] })
  })

  it('the global admin gets 200 with an empty booking list', async () => {
    seedContact()
    signIn('admin@me.test')
    const res = await bookingsGET(request('GET', undefined, `?contactId=${CONTACT_A1}`), p(CLIENT_A))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ bookings: [] })
  })
})

describe('the members route is admin only and acts as the session', () => {
  it('admin POST normalises the email and records the session as granted_by', async () => {
    signIn('admin@me.test')
    const res = await membersPOST(request('POST', { email: ' NEW@A.test ' }), p(CLIENT_A))
    expect(res.status).toBe(200)
    const rows = state().tables[MEMBERS_TABLE] ?? []
    const stored = rows.find((r) => r.client_id === CLIENT_A && r.email === 'new@a.test')
    expect(stored).toBeDefined()
    expect(stored?.granted_by).toBe('admin@me.test')
  })

  it('a body-supplied granted_by is rejected and nothing is stored', async () => {
    signIn('admin@me.test')
    const res = await membersPOST(request('POST', { email: 'x@a.test', granted_by: 'evil@x.test' }), p(CLIENT_A))
    expect(res.status).toBe(400)
    expect(state().tables[MEMBERS_TABLE] ?? []).toEqual([])
  })

  it('a malformed email is a 400 invalid_email', async () => {
    signIn('admin@me.test')
    const res = await membersPOST(request('POST', { email: 'nope' }), p(CLIENT_A))
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: string }).error).toBe('invalid_email')
  })

  it('an over-long email is a 400', async () => {
    signIn('admin@me.test')
    const res = await membersPOST(request('POST', { email: `${'a'.repeat(200)}@a.test` }), p(CLIENT_A))
    expect(res.status).toBe(400)
  })

  it('admin DELETE removes the member', async () => {
    state().tables[MEMBERS_TABLE].push(listed('new@a.test', CLIENT_A))
    signIn('admin@me.test')
    const res = await membersDELETE(request('DELETE', undefined, '?email=NEW@A.test'), p(CLIENT_A))
    expect(res.status).toBe(200)
    expect((state().tables[MEMBERS_TABLE] ?? []).some((r) => r.email === 'new@a.test')).toBe(false)
  })

  it('a listed non-admin member is refused on all three methods', async () => {
    state().tables[PORTAL_USERS_TABLE].push(portalUser('staff@a.test', CLIENT_A, 'dashboard'))
    state().tables[MEMBERS_TABLE].push(listed('staff@a.test', CLIENT_A))
    signIn('staff@a.test')
    const get = await membersGET(request('GET'), p(CLIENT_A))
    expect(get.status).toBe(403)
    const post = await membersPOST(request('POST', { email: 'new@a.test' }), p(CLIENT_A))
    expect(post.status).toBe(403)
    const del = await membersDELETE(request('DELETE', undefined, '?email=old@a.test'), p(CLIENT_A))
    expect(del.status).toBe(403)
  })
})

describe('flow: a member added by the admin can then reach the tracker', () => {
  it('staff@a.test passes the gate on GET bookings after being added', async () => {
    state().tables[PORTAL_USERS_TABLE].push(portalUser('staff@a.test', CLIENT_A, 'dashboard'))
    signIn('admin@me.test')
    const added = await membersPOST(request('POST', { email: 'staff@a.test' }), p(CLIENT_A))
    expect(added.status).toBe(200)
    signIn('staff@a.test')
    const res = await bookingsGET(request('GET', undefined, `?contactId=${CONTACT_A1}`), p(CLIENT_A))
    expect(await passedGate(res)).toBe(true)
  })
})
