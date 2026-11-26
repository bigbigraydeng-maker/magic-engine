/**
 * Distributor portal: one-time invites, session lookup, cookie parsing, and that the portal view only
 * ever contains the signed-in distributor's own money.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Op = { table: string; op: string; filters: Record<string, unknown>; payload?: unknown }
type Result = { data: unknown; error: { message: string; code?: string } | null }

const h = vi.hoisted(() => ({
  respond: (() => ({ data: null, error: null })) as (op: Op) => Result,
  calls: [] as Op[],
}))

function builder(table: string) {
  const state: Op = { table, op: 'select', filters: {} }
  const set = (k: string, v: unknown) => { state.filters[k] = v; return b }
  const b = {
    select: () => b,
    eq: (k: string, v: unknown) => set(`eq:${k}`, v),
    is: (k: string, v: unknown) => set(`is:${k}`, v),
    gt: (k: string, v: unknown) => set(`gt:${k}`, v),
    order: () => b,
    range: () => b,
    insert: (p: unknown) => { state.op = 'insert'; state.payload = p; return b },
    update: (p: unknown) => { state.op = 'update'; state.payload = p; return b },
    maybeSingle: () => b,
    then: (resolve: (r: Result) => unknown) => {
      h.calls.push({ ...state, filters: { ...state.filters } })
      return Promise.resolve(resolve(h.respond(state)))
    },
  }
  return b
}

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: (t: string) => builder(t) } }))

import { PORTAL_COOKIE, PORTAL_COOKIE_SECURE, createInvite, hashToken, redeemInvite, resolveSession, revokeAllAccess, sessionCookie, sessionTokenFrom } from '../portal-auth'
import { isCrossOrigin } from '../admin-http'
import { buildPortalView } from '../portal-view'

const NOW = Date.parse('2026-11-10T00:00:00Z')
const TOKEN = 'A'.repeat(43)

beforeEach(() => { h.calls = [] })

describe('portal auth', () => {
  it('only approved or suspended distributors get an invite; the stored value is a hash, not the token', async () => {
    h.respond = (op) => (op.table === 'distributors' ? { data: { status: 'pending' }, error: null } : { data: null, error: null })
    await expect(createInvite('d1', 'pm@x', NOW)).rejects.toMatchObject({ status: 409 })
    h.respond = (op) => (op.table === 'distributors' ? { data: { status: 'approved' }, error: null } : { data: null, error: null })
    const { token, expiresAt } = await createInvite('d1', 'pm@x', NOW)
    const revokeOld = h.calls.find((c) => c.op === 'update')
    expect(revokeOld?.filters).toMatchObject({ 'eq:distributor_id': 'd1', 'eq:kind': 'invite', 'is:used_at': null, 'is:revoked_at': null })
    const insert = h.calls.find((c) => c.op === 'insert')?.payload as { token_hash: string; kind: string }
    expect(insert.kind).toBe('invite')
    expect(insert.token_hash).toBe(hashToken(token))
    expect(insert.token_hash).not.toContain(token)
    expect(expiresAt).toBe('2026-11-11T00:00:00.000Z')
  })

  it('redeems an invite only once, and only if unused, unrevoked and unexpired', async () => {
    h.respond = (op) => {
      if (op.table === 'distributors') return { data: { status: 'approved' }, error: null }
      if (op.op === 'update') return { data: { distributor_id: 'd1' }, error: null }
      return { data: null, error: null }
    }
    const session = await redeemInvite(TOKEN, NOW)
    expect(session?.sessionToken).toMatch(/^[A-Za-z0-9_-]{43}$/)
    const update = h.calls.find((c) => c.op === 'update')
    expect(update?.filters).toMatchObject({ 'eq:kind': 'invite', 'is:used_at': null, 'is:revoked_at': null, 'gt:expires_at': '2026-11-10T00:00:00.000Z' })
    h.respond = () => ({ data: null, error: null }) // already used → conditional update matches nothing
    expect(await redeemInvite(TOKEN, NOW)).toBeNull()
    expect(await redeemInvite('not a token', NOW)).toBeNull()
  })

  it('drops the session as soon as the distributor is no longer approved or suspended', async () => {
    let status = 'approved'
    h.respond = (op) => (op.table === 'distributors' ? { data: { status }, error: null } : { data: { distributor_id: 'd1' }, error: null })
    expect(await resolveSession(TOKEN, NOW)).toBe('d1')
    const lookup = h.calls.find((c) => c.table === 'distributor_portal_tokens')
    // An invite token must never work as a session cookie; revoked or expired sessions must not either.
    expect(lookup?.filters).toMatchObject({ 'eq:token_hash': hashToken(TOKEN), 'eq:kind': 'session', 'is:revoked_at': null, 'gt:expires_at': '2026-11-10T00:00:00.000Z' })
    status = 'rejected'
    expect(await resolveSession(TOKEN, NOW)).toBeNull()
    expect(await resolveSession(null, NOW)).toBeNull()
  })

  it('reads only a well-formed portal cookie and writes it httpOnly', () => {
    const req = (cookie: string) => new Request('http://x', { headers: { cookie } })
    expect(sessionTokenFrom(req(`a=1; ${PORTAL_COOKIE}=${TOKEN}; b=2`))).toBe(TOKEN)
    expect(sessionTokenFrom(req(`${PORTAL_COOKIE}=short`))).toBeNull()
    expect(sessionTokenFrom(req('sb-access-token=xyz'))).toBeNull()
    expect(sessionTokenFrom(req(`${PORTAL_COOKIE}=${'B'.repeat(43)}; ${PORTAL_COOKIE_SECURE}=${TOKEN}`))).toBe(TOKEN)
    const cookie = sessionCookie(TOKEN, '2026-12-10T00:00:00Z', true)
    expect(cookie.startsWith(`${PORTAL_COOKIE_SECURE}=`)).toBe(true)
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('Secure')
    expect(cookie).toContain('SameSite=Lax')
  })
})

describe('revoke and origin checks', () => {
  it('revokes every live token of one distributor', async () => {
    h.respond = (op) => (op.op === 'update' ? { data: [{ id: 'a' }, { id: 'b' }], error: null } : { data: null, error: null })
    expect(await revokeAllAccess('d1', NOW)).toBe(2)
    expect(h.calls[0].filters).toMatchObject({ 'eq:distributor_id': 'd1', 'is:revoked_at': null })
  })

  it('treats Origin null or missing as cross-site, and accepts APP_URL when req.url is the internal address', () => {
    const r = (headers: Record<string, string>) => new Request('http://localhost:10000/api/x', { method: 'POST', headers })
    expect(isCrossOrigin(r({}))).toBe(true)
    expect(isCrossOrigin(r({ origin: 'null' }))).toBe(true)
    expect(isCrossOrigin(r({ origin: 'https://evil.example', host: 'app.test' }))).toBe(true)
    expect(isCrossOrigin(r({ origin: 'https://app.test', 'x-forwarded-host': 'app.test', 'x-forwarded-proto': 'https' }))).toBe(false)
    const before = process.env.APP_URL
    process.env.APP_URL = 'https://app.magic.test'
    expect(isCrossOrigin(r({ origin: 'https://app.magic.test' }))).toBe(false)
    if (before === undefined) delete process.env.APP_URL
    else process.env.APP_URL = before
  })
})

describe('portal view', () => {
  it('reads sales, balances and lines filtered to the signed-in distributor only', async () => {
    h.respond = (op) => {
      if (op.table === 'distributors') return { data: [
        { id: 'me', parent_id: null, status: 'approved', display_name: '我', approved_at: '2026-01-01T00:00:00Z' },
        { id: 'kid', parent_id: 'me', status: 'approved', display_name: '下级', approved_at: '2026-01-01T00:00:00Z' },
        { id: 'applicant', parent_id: 'me', status: 'pending', display_name: 'http://phish.example 点这里', approved_at: null },
        { id: 'refused', parent_id: 'me', status: 'rejected', display_name: '被拒', approved_at: null },
      ], error: null }
      if (op.table === 'distributor_level_history') return { data: [
        { id: 'l1', distributor_id: 'me', level: 'tier1', effective_from: '2026-01-01T00:00:00Z' },
        { id: 'l2', distributor_id: 'kid', level: 'standard', effective_from: '2026-01-01T00:00:00Z' },
      ], error: null }
      if (op.table === 'distributor_statements') return { data: [{ id: 'st', period_month: '2026-10-01', status: 'approved' }], error: null }
      if (op.table === 'distributor_statement_balances') return { data: [{ statement_id: 'st', opening_cents: 0, payout_cents: 500, closing_cents: 0, team_sales_cents: 9 }], error: null }
      if (op.table === 'distributor_commission_lines') return { data: [{ statement_id: 'st', kind: 'retail', amount_cents: 500, payable: true }], error: null }
      if (op.table === 'distributor_sales') return { data: [], error: null }
      return { data: null, error: null }
    }
    const view = await buildPortalView('me', new Date(NOW))
    for (const table of ['distributor_sales', 'distributor_statement_balances', 'distributor_commission_lines']) {
      const call = h.calls.find((c) => c.table === table)
      expect(call?.filters['eq:distributor_id'], table).toBe('me')
    }
    expect(view.profile).toMatchObject({ display_name: '我', level: 'tier1' })
    expect(view.team).toEqual({ direct: [{ display_name: '下级', level: 'standard', status: 'approved' }], total: 1 })
    expect(view.statements).toEqual([{ month: '2026-10', status: 'approved', payout_cents: 500, closing_cents: 0, opening_cents: 0, retail_cents: 500, peer_cents: 0, team_cents: 0 }])
    expect(JSON.stringify(view.team)).not.toMatch(/cents/)
  })
})
