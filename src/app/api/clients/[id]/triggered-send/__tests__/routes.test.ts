import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/client-access', () => ({ requireDashboardClientAccess: vi.fn() }))
vi.mock('@/lib/auth/whitelist', () => ({ isGlobalAdminEmail: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))
vi.mock('@/lib/messaging/triggered-send/authorization-deps-prod', () => ({
  createAuthorizationDeps: vi.fn(() => ({ marker: 'deps' })),
  createAuthorizationStatusDeps: vi.fn(() => ({ marker: 'status-deps' })),
}))
vi.mock('@/lib/messaging/triggered-send/authorization-commands', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/messaging/triggered-send/authorization-commands')>()
  return { ...actual, proposeCommand: vi.fn(), revokeCommand: vi.fn() }
})
vi.mock('@/lib/messaging/triggered-send/authorization-authorize', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/messaging/triggered-send/authorization-authorize')>()
  return { ...actual, authorizeCommand: vi.fn() }
})
vi.mock('@/lib/messaging/triggered-send/authorization-status', () => ({ statusQuery: vi.fn() }))
vi.mock('@/lib/messaging/triggered-send/resolve-store', () => ({ createResolveDeps: vi.fn(() => ({ marker: 'resolve-deps' })) }))
vi.mock('@/lib/messaging/triggered-send/resolve-unknown', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/messaging/triggered-send/resolve-unknown')>()
  return { ...actual, resolveUnknownCommand: vi.fn() }
})

import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { isGlobalAdminEmail } from '@/lib/auth/whitelist'
import { authorizeCommand } from '@/lib/messaging/triggered-send/authorization-authorize'
import { proposeCommand, revokeCommand } from '@/lib/messaging/triggered-send/authorization-commands'
import { statusQuery } from '@/lib/messaging/triggered-send/authorization-status'
import { resolveUnknownCommand } from '@/lib/messaging/triggered-send/resolve-unknown'
import { POST as authorizePOST } from '../authorize/route'
import { POST as proposePOST } from '../propose/route'
import { POST as resolvePOST } from '../resolve-unknown/route'
import { POST as revokePOST } from '../revoke/route'
import { GET as statusGET } from '../status/route'

const CLIENT = 'c0000000-0000-0000-0000-000000000000'
const USER_ID = 'e0000000-0000-4000-8000-000000000001'
const SHA = 'a'.repeat(64)
const ID = 'f0000000-0000-4000-8000-000000000001'

const mockedAccess = vi.mocked(requireDashboardClientAccess)
const mockedAdmin = vi.mocked(isGlobalAdminEmail)
const commands = {
  propose: vi.mocked(proposeCommand),
  authorize: vi.mocked(authorizeCommand),
  revoke: vi.mocked(revokeCommand),
  resolve: vi.mocked(resolveUnknownCommand),
  status: vi.mocked(statusQuery),
}

const globalAdmin = { ok: true as const, user: { id: USER_ID, email: 'PM@Example.com' }, role: 'admin' as const, tier: 'admin' as const, allowedClientId: null }

const bodies: Record<'propose' | 'authorize' | 'revoke' | 'resolve-unknown', Record<string, unknown>> = {
  propose: { client_id: CLIENT, account: 'cts', daily_cap: 20, rule: {}, confirm: false },
  authorize: { client_id: CLIENT, authorization_id: ID, rule_sha256: SHA, template_sha256: SHA },
  revoke: { client_id: CLIENT, authorization_id: ID, reason: 'stop' },
  'resolve-unknown': { client_id: CLIENT, send_id: ID, outcome: 'not_sent', seen_updated_at: '2026-11-19T22:00:00.123456+00:00' },
}
const handlers = { propose: proposePOST, authorize: authorizePOST, revoke: revokePOST, 'resolve-unknown': resolvePOST }
type WriteName = keyof typeof handlers
const WRITES: WriteName[] = ['propose', 'authorize', 'revoke', 'resolve-unknown']

function post(name: WriteName, body: unknown, opts: { clientId?: string; contentType?: string } = {}) {
  const clientId = opts.clientId ?? CLIENT
  const req = new NextRequest(`http://localhost/api/clients/${clientId}/triggered-send/${name}`, {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'content-type': opts.contentType ?? 'application/json' },
  })
  return handlers[name](req, { params: { id: clientId } })
}

function getStatus(clientId = CLIENT) {
  return statusGET(new NextRequest(`http://localhost/api/clients/${clientId}/triggered-send/status`), { params: { id: clientId } })
}

let originalApprovers: string | undefined

beforeEach(() => {
  vi.clearAllMocks()
  originalApprovers = process.env.TRIGGERED_SEND_APPROVER_EMAILS
  process.env.TRIGGERED_SEND_APPROVER_EMAILS = ' pm@example.com '
  mockedAccess.mockResolvedValue(globalAdmin as never)
  mockedAdmin.mockReturnValue(true)
  for (const c of [commands.propose, commands.authorize, commands.revoke, commands.resolve, commands.status]) {
    c.mockResolvedValue({ status: 200, body: { success: true, mode: 'PREVIEW' } })
  }
})

describe('🔴 who may call the four endpoints', () => {
  it('nobody logged in: 401, nothing runs', async () => {
    mockedAccess.mockResolvedValue({ ok: false, status: 401, error: 'Unauthorized' })
    for (const name of WRITES) expect((await post(name, bodies[name])).status).toBe(401)
    expect((await getStatus()).status).toBe(401)
    for (const c of Object.values(commands)) expect(c).not.toHaveBeenCalled()
  })

  it('a logged-in person who is not a global administrator: 403; the status says only can_manage=false', async () => {
    mockedAdmin.mockReturnValue(false)
    for (const name of WRITES) {
      const res = await post(name, bodies[name])
      expect(res.status).toBe(403)
      expect((await res.json()).error).toBe('GLOBAL_ADMIN_REQUIRED')
    }
    const status = await getStatus()
    expect(status.status).toBe(200)
    expect(await status.json()).toEqual({ success: true, can_manage: false })
    for (const c of Object.values(commands)) expect(c).not.toHaveBeenCalled()
  })

  it('an admin limited to this one client (scoped / demo admin), even with a listed e-mail: 403', async () => {
    mockedAccess.mockResolvedValue({ ...globalAdmin, allowedClientId: CLIENT } as never)
    for (const name of WRITES) expect((await post(name, bodies[name])).status).toBe(403)
    expect(await (await getStatus()).json()).toEqual({ success: true, can_manage: false })
    for (const c of Object.values(commands)) expect(c).not.toHaveBeenCalled()
  })

  it('a client portal user, even the paying owner of this very client: 403', async () => {
    mockedAccess.mockResolvedValue({
      ok: true,
      user: { id: USER_ID, email: 'owner@client.example' },
      role: 'client-viewer',
      tier: 'paid_client',
      allowedClientId: CLIENT,
    } as never)
    mockedAdmin.mockReturnValue(false)
    for (const name of WRITES) expect((await post(name, bodies[name])).status).toBe(403)
    expect(await (await getStatus()).json()).toEqual({ success: true, can_manage: false })
    for (const c of Object.values(commands)) expect(c).not.toHaveBeenCalled()
  })

  it('a client id that is not a lower-case uuid is refused before any access lookup', async () => {
    for (const name of WRITES) expect((await post(name, bodies[name], { clientId: 'C0000000-0000-0000-0000-000000000000' })).status).toBe(400)
    expect((await getStatus('nope')).status).toBe(400)
    expect(mockedAccess).not.toHaveBeenCalled()
  })
})

afterEach(() => {
  if (originalApprovers === undefined) delete process.env.TRIGGERED_SEND_APPROVER_EMAILS
  else process.env.TRIGGERED_SEND_APPROVER_EMAILS = originalApprovers
})

describe('🔴 authorizing: the PM himself only (the approver list), never just any global administrator', () => {
  it('a global administrator who is not on the approver list cannot authorize, but can still propose and revoke', async () => {
    mockedAccess.mockResolvedValue({ ...globalAdmin, user: { id: USER_ID, email: 'other-admin@example.com' } } as never)
    const res = await post('authorize', bodies.authorize)
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe('APPROVER_REQUIRED')
    expect(commands.authorize).not.toHaveBeenCalled()
    expect((await post('revoke', bodies.revoke)).status).toBe(200)
    expect((await post('propose', bodies.propose)).status).toBe(200)
    await getStatus()
    expect(commands.status).toHaveBeenCalledWith({ marker: 'status-deps' }, CLIENT, { canAuthorize: false })
  })

  it('no approver list configured = nobody may authorize (no fall-back to the admin list)', async () => {
    delete process.env.TRIGGERED_SEND_APPROVER_EMAILS
    expect((await post('authorize', bodies.authorize)).status).toBe(403)
    process.env.TRIGGERED_SEND_APPROVER_EMAILS = ''
    expect((await post('authorize', bodies.authorize)).status).toBe(403)
    expect(commands.authorize).not.toHaveBeenCalled()
  })

  it('the PM on the list may authorize, and the page is told so', async () => {
    expect((await post('authorize', bodies.authorize)).status).toBe(200)
    await getStatus()
    expect(commands.status).toHaveBeenCalledWith({ marker: 'status-deps' }, CLIENT, { canAuthorize: true })
  })
})

describe('🔴 「已发出 / 没发出」: the PM himself only, like authorizing (「没发出」 means never welcomed automatically again)', () => {
  it('a global administrator who is not on the approver list cannot settle a letter', async () => {
    mockedAccess.mockResolvedValue({ ...globalAdmin, user: { id: USER_ID, email: 'other-admin@example.com' } } as never)
    const res = await post('resolve-unknown', { ...bodies['resolve-unknown'], confirm: true })
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe('APPROVER_REQUIRED')
    expect(commands.resolve).not.toHaveBeenCalled()
  })

  it('no approver list configured = nobody may settle a letter', async () => {
    delete process.env.TRIGGERED_SEND_APPROVER_EMAILS
    expect((await post('resolve-unknown', bodies['resolve-unknown'])).status).toBe(403)
    expect(commands.resolve).not.toHaveBeenCalled()
  })

  it('the PM on the list may; the command gets him, the ledger port and the body (a preview unless confirmed)', async () => {
    expect((await post('resolve-unknown', bodies['resolve-unknown'])).status).toBe(200)
    expect(commands.resolve).toHaveBeenCalledWith(
      { marker: 'resolve-deps' },
      CLIENT,
      { email: 'pm@example.com', userId: USER_ID },
      expect.objectContaining({ send_id: ID, outcome: 'not_sent', confirm: false }),
    )
  })

  it('refuses an answer other than the two', async () => {
    expect((await post('resolve-unknown', { ...bodies['resolve-unknown'], outcome: 'delivered' })).status).toBe(400)
    expect(commands.resolve).not.toHaveBeenCalled()
  })
})

describe('the write endpoints', () => {
  it('🔴 refuse a body that is not declared JSON (a cross-site form cannot post here)', async () => {
    for (const name of WRITES) {
      const res = await post(name, JSON.stringify(bodies[name]), { contentType: 'text/plain' })
      expect(res.status).toBe(415)
    }
    for (const c of Object.values(commands)) expect(c).not.toHaveBeenCalled()
  })

  it('refuse an invalid body and a client id that differs from the path', async () => {
    for (const name of WRITES) {
      expect((await post(name, { nope: true })).status).toBe(400)
      const mismatch = await post(name, { ...bodies[name], client_id: 'd0000000-0000-4000-8000-000000000000' })
      expect((await mismatch.json()).error).toBe('CLIENT_ID_MISMATCH')
    }
    for (const c of Object.values(commands)) expect(c).not.toHaveBeenCalled()
  })

  it('pass the logged-in person (lower-cased e-mail and user id) and answer what the command answers, never cached', async () => {
    commands.authorize.mockResolvedValue({ status: 422, body: { success: false, error: 'REHEARSAL_NOT_READY' } })
    const res = await post('authorize', bodies.authorize)
    expect(res.status).toBe(422)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(commands.authorize).toHaveBeenCalledWith({ marker: 'deps' }, CLIENT, { email: 'pm@example.com', userId: USER_ID }, expect.objectContaining({ confirm: false }))
  })

  it('a command that throws is a 500 without its message', async () => {
    commands.revoke.mockRejectedValue(new Error('row with secret detail'))
    const res = await post('revoke', bodies.revoke)
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain('secret detail')
  })
})

describe('the status endpoint', () => {
  it('answers what the status query answers for a global administrator, never cached', async () => {
    commands.status.mockResolvedValue({ status: 200, body: { success: true, can_manage: true, proposal: null } })
    const res = await getStatus()
    expect(await res.json()).toEqual({ success: true, can_manage: true, proposal: null })
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(commands.status).toHaveBeenCalledWith({ marker: 'status-deps' }, CLIENT, { canAuthorize: true })
  })
})
