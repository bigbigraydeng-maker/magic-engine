import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * Isolation proof for every tour-catalog handler (design §6.10 A / §6.10.1 item 1).
 *
 * Nothing in the access path is mocked: the REAL requireDashboardClientAccess and the REAL
 * requireCatalogAccess run. Only what sits underneath them is replaced — the sign-in session and
 * the database client, the latter by a table-shaped fake holding the two membership tables.
 * The catalog's own store modules are real too, so "the database was not touched" is measured at
 * the only door they have: any `.from(<other table>)` or `.rpc(...)` on the fake is recorded.
 */

const CLIENT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const CLIENT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const TOUR_ID = '11111111-1111-4111-8111-111111111111'
const DEPARTURE_ID = '22222222-2222-4222-8222-222222222222'
const BATCH_ID = '33333333-3333-4333-8333-333333333333'

const MEMBERS_TABLE = ['tour', 'catalog', 'members'].join('_')
const PORTAL_USERS_TABLE = 'client_portal_users'

type Row = Record<string, unknown>

const world = vi.hoisted(() => ({
  sessionEmail: null as string | null,
  tables: {} as Record<string, Array<Record<string, unknown>>>,
  /** `.from()` on anything but the two membership tables, every write, and every `.rpc()`. */
  touches: [] as string[],
  /** Reads of the two membership tables (the gate itself needs at most one of each). */
  membershipReads: [] as string[],
  /** Arguments of every `.rpc()` call, in order. */
  rpcArgs: [] as Array<{ name: string; args: unknown }>,
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

vi.mock('@/lib/supabase', () => {
  const authTables = new Set(['client_portal_users', ['tour', 'catalog', 'members'].join('_')])

  function query(table: string) {
    const eqs: Array<[string, unknown]> = []
    const ins: Array<[string, unknown[]]> = []
    let single = false
    const run = () => {
      const rows = (world.tables[table] ?? []).filter(
        (row) => eqs.every(([c, v]) => row[c] === v) && ins.every(([c, vs]) => vs.includes(row[c])),
      )
      return { data: single ? (rows[0] ?? null) : rows, error: null }
    }
    const builder: Record<string, unknown> = {}
    const chain = () => builder
    for (const name of ['select', 'is', 'or', 'order', 'limit', 'gt', 'gte', 'lt', 'neq', 'not', 'contains', 'range']) {
      builder[name] = chain
    }
    for (const name of ['insert', 'update', 'upsert', 'delete']) {
      builder[name] = () => {
        world.touches.push(`${name}:${table}`)
        return builder
      }
    }
    builder.eq = (column: string, value: unknown) => {
      eqs.push([column, value])
      return builder
    }
    builder.in = (column: string, values: unknown[]) => {
      ins.push([column, values])
      return builder
    }
    builder.maybeSingle = () => {
      single = true
      return builder
    }
    builder.single = builder.maybeSingle
    builder.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(run()).then(resolve, reject)
    return builder
  }

  return {
    supabaseAdmin: {
      from(table: string) {
        if (authTables.has(table)) world.membershipReads.push(table)
        else world.touches.push(`from:${table}`)
        return query(table)
      },
      rpc(name: string, args?: unknown) {
        world.touches.push(`rpc:${name}`)
        world.rpcArgs.push({ name, args })
        return Promise.resolve({ data: null, error: null })
      },
    },
  }
})

import { GET as catalogGET } from '../route'
import { PATCH as tourPATCH } from '../tours/[tourId]/route'
import { POST as departurePOST } from '../tours/[tourId]/departures/route'
import { PATCH as departurePATCH } from '../departures/[departureId]/route'
import { GET as changesGET } from '../changes/route'
import { POST as assistantPOST } from '../assistant/route'
import { POST as aliasPOST, DELETE as aliasDELETE } from '../aliases/route'
import { POST as previewPOST } from '../preview/route'
import { POST as applyPOST } from '../batches/[batchId]/apply/route'
import { POST as rollbackPOST } from '../batches/[batchId]/rollback/route'
import { POST as seedPOST } from '../seed/route'
import { GET as publishGET, POST as publishPOST } from '../publish/route'
import { GET as historyGET } from '../publish/history/route'
import { GET as revertGET, POST as revertPOST } from '../publish/revert/route'
import { GET as membersGET, POST as membersPOST, DELETE as membersDELETE } from '../members/route'
import { PUT as settingsPUT } from '../settings/route'
import { POST as publishRequestPOST } from '../publish-requests/route'
import type { CatalogCapability } from '@/lib/tour-catalog/catalog-contract'

function request(method: string, body?: unknown, query = ''): NextRequest {
  return new NextRequest(`http://localhost/api/clients/x/tour-catalog${query}`, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
  })
}

interface HandlerCase {
  name: string
  capability: CatalogCapability
  call: (clientId: string) => Promise<Response>
}

const p = <T extends Record<string, string>>(clientId: string, extra: T) => ({
  params: Promise.resolve({ id: clientId, ...extra }),
})

/** Every exported handler, each with a request that would reach the database if access were granted. */
const HANDLERS: HandlerCase[] = [
  { name: 'GET catalog', capability: 'view', call: (c) => catalogGET(request('GET'), p(c, {})) },
  {
    name: 'PATCH tour',
    capability: 'edit',
    call: (c) =>
      tourPATCH(request('PATCH', { expectedUpdatedAt: '2026-01-01T00:00:00Z', patch: { name: 'X' } }), p(c, { tourId: TOUR_ID })),
  },
  {
    name: 'POST departure',
    capability: 'edit',
    call: (c) => departurePOST(request('POST', { departOn: '2027-03-11', returnOn: '2027-03-25' }), p(c, { tourId: TOUR_ID })),
  },
  {
    name: 'PATCH departure',
    capability: 'edit',
    call: (c) =>
      departurePATCH(
        request('PATCH', { tourId: TOUR_ID, expectedUpdatedAt: '2026-01-01T00:00:00Z', patch: { status: 'closed' } }),
        p(c, { departureId: DEPARTURE_ID }),
      ),
  },
  { name: 'GET changes', capability: 'view', call: (c) => changesGET(request('GET'), p(c, {})) },
  { name: 'GET changes?tourId', capability: 'view', call: (c) => changesGET(request('GET', undefined, `?tourId=${TOUR_ID}`), p(c, {})) },
  { name: 'POST assistant', capability: 'assistant', call: (c) => assistantPOST(request('POST', { message: 'hi' }), p(c, {})) },
  { name: 'POST alias', capability: 'aliases', call: (c) => aliasPOST(request('POST', { alias: 'golden', tourId: TOUR_ID }), p(c, {})) },
  { name: 'DELETE alias', capability: 'aliases', call: (c) => aliasDELETE(request('DELETE', { aliasNorm: 'golden' }), p(c, {})) },
  {
    name: 'POST preview',
    capability: 'import',
    call: (c) =>
      previewPOST(
        request('POST', {
          csv: '出团日期,行程名称,航空公司,人数,去程航段,返程日期,返程航段\n2027-03-11,Best Of China,国航,20,奥克兰-北京+1,2027-03-25,北京-奥克兰\n',
        }),
        p(c, {}),
      ),
  },
  { name: 'POST apply batch', capability: 'import', call: (c) => applyPOST(request('POST', { planHash: 'h' }), p(c, { batchId: BATCH_ID })) },
  { name: 'POST rollback batch', capability: 'import', call: (c) => rollbackPOST(request('POST'), p(c, { batchId: BATCH_ID })) },
  { name: 'POST seed', capability: 'seed', call: (c) => seedPOST(request('POST'), p(c, {})) },
  { name: 'GET publish', capability: 'view', call: (c) => publishGET(request('GET'), p(c, {})) },
  {
    name: 'POST publish',
    capability: 'publish',
    call: (c) =>
      publishPOST(
        request('POST', {
          draftVersion: 1,
          publishedVersion: 0,
          diffHash: 'h',
          acknowledgeHighRisk: true,
          acknowledgeAfterRevert: true,
          confirmSellableCount: 0,
          note: '',
        }),
        p(c, {}),
      ),
  },
  { name: 'GET publish history', capability: 'view', call: (c) => historyGET(request('GET'), p(c, {})) },
  { name: 'GET revert preview', capability: 'publish', call: (c) => revertGET(request('GET', undefined, '?version=1'), p(c, {})) },
  {
    name: 'POST revert',
    capability: 'publish',
    call: (c) =>
      revertPOST(
        request('POST', { version: 1, publishedVersion: 2, diffHash: 'h', acknowledgeHighRisk: true, confirmSellableCount: null }),
        p(c, {}),
      ),
  },
  { name: 'GET members', capability: 'manage_members', call: (c) => membersGET(request('GET'), p(c, {})) },
  { name: 'POST member', capability: 'manage_members', call: (c) => membersPOST(request('POST', { email: 'new@b.test' }), p(c, {})) },
  {
    name: 'DELETE member',
    capability: 'manage_members',
    call: (c) => membersDELETE(request('DELETE', undefined, '?email=staff@b.test'), p(c, {})),
  },
  {
    name: 'PUT settings',
    capability: 'manage_settings',
    call: (c) =>
      settingsPUT(request('PUT', { logoUrl: null, brandPrimary: '#B61E2E', brandSecondary: null, channelsConnected: false }), p(c, {})),
  },
  { name: 'POST publish request', capability: 'request_publish', call: (c) => publishRequestPOST(request('POST', { note: 'please' }), p(c, {})) },
]

const EDITOR_CAPABILITIES: CatalogCapability[] = ['view', 'edit', 'assistant', 'request_publish']
const EDITOR_ALLOWED = HANDLERS.filter((h) => EDITOR_CAPABILITIES.includes(h.capability))
const EDITOR_DENIED = HANDLERS.filter((h) => !EDITOR_CAPABILITIES.includes(h.capability))

function portalUser(email: string, clientId: string, accessType: string, scopedAdmin = false): Row {
  return { email, client_id: clientId, access_type: accessType, scoped_admin: scopedAdmin }
}

function member(email: string, clientId: string): Row {
  return { email, client_id: clientId, granted_by: 'admin@me.test' }
}

function signIn(email: string | null): void {
  world.sessionEmail = email
}

beforeEach(() => {
  world.sessionEmail = null
  world.touches = []
  world.rpcArgs = []
  world.membershipReads = []
  world.tables = { [PORTAL_USERS_TABLE]: [], [MEMBERS_TABLE]: [] }
  delete process.env.TOUR_CATALOG_LOCAL_TEST
  delete process.env.TOUR_CATALOG_LOCAL_ROLE
  delete process.env.TOUR_CATALOG_LOCAL_EMAIL
  process.env.ADMIN_EMAILS = 'admin@me.test'
  process.env.DEMO_ADMINS = `demo@me.test:${CLIENT_A}`
  process.env.CLIENT_VIEWERS = `envviewer@a.test:${CLIENT_A}`
  delete process.env.ADMIN_EMAIL_DOMAIN
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'info').mockImplementation(() => {})
})

async function expectRefused(handler: HandlerCase, clientId: string, status: number): Promise<void> {
  const res = await handler.call(clientId)
  expect(res.status, handler.name).toBe(status)
  expect(world.touches, `${handler.name} touched the database`).toEqual([])
  // Nothing beyond the gate's own lookups: at most one read of each membership table per request.
  for (const table of [PORTAL_USERS_TABLE, MEMBERS_TABLE]) {
    expect(world.membershipReads.filter((t) => t === table).length, `${handler.name} read ${table} again`).toBeLessThanOrEqual(1)
  }
  world.membershipReads = []
}

describe('the matrix covers every handler', () => {
  it('has one case per registered handler (22 exported methods; changes is exercised in both shapes)', () => {
    expect(HANDLERS).toHaveLength(23)
    expect(EDITOR_ALLOWED.length + EDITOR_DENIED.length).toBe(HANDLERS.length)
    expect(EDITOR_DENIED.map((h) => h.name)).toEqual([
      'POST alias',
      'DELETE alias',
      'POST preview',
      'POST apply batch',
      'POST rollback batch',
      'POST seed',
      'POST publish',
      'GET revert preview',
      'POST revert',
      'GET members',
      'POST member',
      'DELETE member',
      'PUT settings',
    ])
  })
})

describe.each(HANDLERS)('$name', (handler) => {
  it('not signed in → 401, database untouched', async () => {
    signIn(null)
    await expectRefused(handler, CLIENT_B, 401)
  })

  it('a listed member of client A asking for client B → 403, database untouched', async () => {
    world.tables[PORTAL_USERS_TABLE].push(portalUser('staff@a.test', CLIENT_A, 'dashboard'))
    world.tables[MEMBERS_TABLE].push(member('staff@a.test', CLIENT_A))
    signIn('staff@a.test')
    await expectRefused(handler, CLIENT_B, 403)
  })

  it('self_serve member, even when on the list → 403, database untouched', async () => {
    world.tables[PORTAL_USERS_TABLE].push(portalUser('free@b.test', CLIENT_B, 'self_serve'))
    world.tables[MEMBERS_TABLE].push(member('free@b.test', CLIENT_B))
    signIn('free@b.test')
    await expectRefused(handler, CLIENT_B, 403)
  })

  it('portal-only member, even when on the list → 403, database untouched', async () => {
    world.tables[PORTAL_USERS_TABLE].push(portalUser('portal@b.test', CLIENT_B, 'portal'))
    world.tables[MEMBERS_TABLE].push(member('portal@b.test', CLIENT_B))
    signIn('portal@b.test')
    await expectRefused(handler, CLIENT_B, 403)
  })

  it('paid member who is not on the list → 403, database untouched', async () => {
    world.tables[PORTAL_USERS_TABLE].push(portalUser('staff@b.test', CLIENT_B, 'both'))
    world.tables[MEMBERS_TABLE].push(member('someone-else@b.test', CLIENT_B))
    signIn('staff@b.test')
    await expectRefused(handler, CLIENT_B, 403)
  })

  it('env-configured viewer and fde member who are not on the list → 403, database untouched', async () => {
    signIn('envviewer@a.test')
    await expectRefused(handler, CLIENT_A, 403)
    world.tables[PORTAL_USERS_TABLE].push(portalUser('fde@b.test', CLIENT_B, 'fde'))
    signIn('fde@b.test')
    await expectRefused(handler, CLIENT_B, 403)
  })

  it('client-restricted admin: other client → 403; own client but not on the list → 403', async () => {
    signIn('demo@me.test')
    await expectRefused(handler, CLIENT_B, 403)
    await expectRefused(handler, CLIENT_A, 403)
    world.tables[PORTAL_USERS_TABLE].push(portalUser('scoped@b.test', CLIENT_B, 'dashboard', true))
    signIn('scoped@b.test')
    await expectRefused(handler, CLIENT_B, 403)
  })

  it('someone with no membership anywhere → 403, database untouched', async () => {
    signIn('stranger@nowhere.test')
    await expectRefused(handler, CLIENT_B, 403)
  })

  it('global admin gets past the gate (control: the request then reaches the database)', async () => {
    signIn('admin@me.test')
    const res = await handler.call(CLIENT_B)
    expect([401, 403]).not.toContain(res.status)
    // A global admin is recognised from configuration, so any database access here is the handler's own work.
    expect(
      world.touches.length + world.membershipReads.length,
      `${handler.name} never reached the database — the refusals above would be vacuous`,
    ).toBeGreaterThan(0)
  })
})

describe('a listed client editor', () => {
  function asEditor(email = 'staff@b.test'): void {
    world.tables[PORTAL_USERS_TABLE].push(portalUser('staff@b.test', CLIENT_B, 'dashboard'))
    world.tables[MEMBERS_TABLE].push(member('staff@b.test', CLIENT_B))
    signIn(email)
  }

  it.each(EDITOR_DENIED)('$name ($capability) → 403, database untouched', async (handler) => {
    asEditor()
    await expectRefused(handler, CLIENT_B, 403)
  })

  it.each(EDITOR_ALLOWED)('$name ($capability) → gets past the gate and reaches the database', async (handler) => {
    asEditor()
    const res = await handler.call(CLIENT_B)
    expect([401, 403]).not.toContain(res.status)
    expect(world.touches.length).toBeGreaterThan(0)
  })

  it.each(HANDLERS)('$name: the same editor asking for client A → 403, database untouched', async (handler) => {
    asEditor()
    await expectRefused(handler, CLIENT_A, 403)
  })

  it('is recognised whatever the letter case of the sign-in email', async () => {
    asEditor('  Staff@B.Test ')
    const res = await catalogGET(request('GET'), p(CLIENT_B, {}))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { viewer: { email: string; role: string } }
    expect(body.viewer).toEqual({ email: 'staff@b.test', role: 'client_editor' })
  })

  it('a client-restricted admin on the list is only an editor: publish stays refused', async () => {
    world.tables[MEMBERS_TABLE].push(member('demo@me.test', CLIENT_A))
    signIn('demo@me.test')
    const view = await catalogGET(request('GET'), p(CLIENT_A, {}))
    expect(view.status).toBe(200)
    expect(((await view.json()) as { viewer: { role: string } }).viewer.role).toBe('client_editor')
    world.touches = []
    world.membershipReads = []
    for (const handler of EDITOR_DENIED) {
      await expectRefused(handler, CLIENT_A, 403)
    }
  })

  it('the identity in the request body is ignored: the actor is the session email', async () => {
    asEditor()
    const res = await publishRequestPOST(
      request('POST', { note: 'x', requestedBy: 'admin@me.test', email: 'admin@me.test', actor: 'admin@me.test' }),
      p(CLIENT_B, {}),
    )
    expect([401, 403]).not.toContain(res.status)
    const calls = world.rpcArgs.filter((call) => call.name === 'tour_catalog_request_publish')
    expect(calls).toHaveLength(1)
    expect(calls[0].args).toMatchObject({ p_client_id: CLIENT_B, p_requested_by: 'staff@b.test', p_note: 'x' })
    expect(JSON.stringify(calls[0].args)).not.toContain('admin@me.test')
  })
})
