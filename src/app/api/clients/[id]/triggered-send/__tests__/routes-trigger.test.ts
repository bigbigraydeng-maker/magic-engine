/**
 * The four authorization routes take an optional `trigger` (design 2026-11-17 §4.5): absent = the welcome letter
 * (every older caller unchanged); the routes pick the deps by it. Authorizing stays the PM's alone, whatever the trigger.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/client-access', () => ({ requireDashboardClientAccess: vi.fn() }))
vi.mock('@/lib/auth/whitelist', () => ({ isGlobalAdminEmail: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { marker: 'db' } }))
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

import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { isGlobalAdminEmail } from '@/lib/auth/whitelist'
import { authorizeCommand } from '@/lib/messaging/triggered-send/authorization-authorize'
import { proposeCommand, revokeCommand } from '@/lib/messaging/triggered-send/authorization-commands'
import { createAuthorizationDeps, createAuthorizationStatusDeps } from '@/lib/messaging/triggered-send/authorization-deps-prod'
import { statusQuery } from '@/lib/messaging/triggered-send/authorization-status'
import { POST as authorizePOST } from '../authorize/route'
import { POST as proposePOST } from '../propose/route'
import { POST as revokePOST } from '../revoke/route'
import { GET as statusGET } from '../status/route'

const CLIENT = 'c0000000-0000-0000-0000-000000000000'
const USER_ID = 'e0000000-0000-4000-8000-000000000001'
const SHA = 'a'.repeat(64)
const ID = 'f0000000-0000-4000-8000-000000000001'
const DB = { marker: 'db' }
const pm = { ok: true as const, user: { id: USER_ID, email: 'pm@example.com' }, role: 'admin' as const, tier: 'admin' as const, allowedClientId: null }

const bodies = {
  propose: { client_id: CLIENT, account: 'cts', daily_cap: 5, rule: {} },
  authorize: { client_id: CLIENT, authorization_id: ID, rule_sha256: SHA, template_sha256: SHA },
  revoke: { client_id: CLIENT, authorization_id: ID, reason: 'stop' },
}
const handlers = { propose: proposePOST, authorize: authorizePOST, revoke: revokePOST }
type Name = keyof typeof handlers

function post(name: Name, body: Record<string, unknown>) {
  const req = new NextRequest(`http://localhost/api/clients/${CLIENT}/triggered-send/${name}`, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })
  return handlers[name](req, { params: { id: CLIENT } })
}

let originalApprovers: string | undefined
beforeEach(() => {
  vi.clearAllMocks()
  originalApprovers = process.env.TRIGGERED_SEND_APPROVER_EMAILS
  process.env.TRIGGERED_SEND_APPROVER_EMAILS = 'pm@example.com'
  vi.mocked(requireDashboardClientAccess).mockResolvedValue(pm as never)
  vi.mocked(isGlobalAdminEmail).mockReturnValue(true)
  for (const c of [proposeCommand, authorizeCommand, revokeCommand, statusQuery]) vi.mocked(c).mockResolvedValue({ status: 200, body: { success: true } })
})
afterEach(() => {
  if (originalApprovers === undefined) delete process.env.TRIGGERED_SEND_APPROVER_EMAILS
  else process.env.TRIGGERED_SEND_APPROVER_EMAILS = originalApprovers
})

describe('the trigger of the authorization routes', () => {
  it('🔴 absent = the welcome letter: the deps are built without a trigger (their default), as before', async () => {
    for (const name of Object.keys(handlers) as Name[]) expect((await post(name, bodies[name])).status).toBe(200)
    expect(vi.mocked(createAuthorizationDeps).mock.calls).toEqual([[DB, undefined], [DB, undefined], [DB, undefined]])
  })

  it('🔴 crm_ai_followup picks the follow-up letters\' deps for every write', async () => {
    for (const name of Object.keys(handlers) as Name[]) expect((await post(name, { ...bodies[name], trigger: 'crm_ai_followup' })).status).toBe(200)
    expect(vi.mocked(createAuthorizationDeps).mock.calls).toEqual([[DB, 'crm_ai_followup'], [DB, 'crm_ai_followup'], [DB, 'crm_ai_followup']])
  })

  it('an unknown trigger is an invalid command, nothing runs', async () => {
    for (const name of Object.keys(handlers) as Name[]) expect((await post(name, { ...bodies[name], trigger: 'newsletter' })).status).toBe(400)
    expect(createAuthorizationDeps).not.toHaveBeenCalled()
  })

  it('🔴 authorizing a follow-up authorization still needs the PM himself (the approver list)', async () => {
    vi.mocked(requireDashboardClientAccess).mockResolvedValue({ ...pm, user: { id: USER_ID, email: 'other-admin@example.com' } } as never)
    const res = await post('authorize', { ...bodies.authorize, trigger: 'crm_ai_followup' })
    expect(res.status).toBe(403)
    expect(authorizeCommand).not.toHaveBeenCalled()
  })

  it('the status reads ?trigger=; absent = the welcome letter; unknown = 400', async () => {
    const get = (q: string) => statusGET(new NextRequest(`http://localhost/api/clients/${CLIENT}/triggered-send/status${q}`), { params: { id: CLIENT } })
    expect((await get('')).status).toBe(200)
    expect((await get('?trigger=crm_ai_followup')).status).toBe(200)
    expect(vi.mocked(createAuthorizationStatusDeps).mock.calls).toEqual([[DB, undefined], [DB, 'crm_ai_followup']])
    expect((await get('?trigger=nope')).status).toBe(400)
    expect(statusQuery).toHaveBeenCalledTimes(2)
  })
})
