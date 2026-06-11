import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  signInWithOtp: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { from: mocks.from },
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ auth: { signInWithOtp: mocks.signInWithOtp } }),
}))

import { POST } from '../route'

// ── Chainable query-builder mock ──────────────────────────────────────────────
// Each supabaseAdmin.from(table) call pops the next queued result for that
// table; every builder method records into dbCalls so tests can assert on
// rollback deletes and call ordering.

interface DbCall {
  table: string
  method: string
  args: unknown[]
}

let dbCalls: DbCall[] = []
let tableQueues: Record<string, unknown[]> = {}

function queueResult(table: string, result: unknown) {
  ;(tableQueues[table] ??= []).push(result)
}

function makeChain(table: string, result: unknown) {
  const chain: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'limit', 'order', 'single', 'maybeSingle', 'insert', 'update', 'delete']) {
    chain[m] = vi.fn((...args: unknown[]) => {
      dbCalls.push({ table, method: m, args })
      return chain
    })
  }
  chain.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject)
  return chain
}

// The route keeps an in-memory per-IP resend window that persists across
// tests — give each test its own x-forwarded-for so quotas never bleed over.
function request(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest('http://localhost:3001/api/auth/self-register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

const NO_ROW = { data: null, error: { code: 'PGRST116', message: 'no rows' } }

describe('POST /api/auth/self-register', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key'
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.com'
    dbCalls = []
    tableQueues = {}
    mocks.from.mockReset()
    mocks.signInWithOtp.mockReset()
    mocks.signInWithOtp.mockResolvedValue({ data: {}, error: null })
    mocks.from.mockImplementation((table: string) => {
      const q = tableQueues[table]
      const result = q && q.length ? q.shift() : { data: null, error: null }
      return makeChain(table, result)
    })
  })

  it('rejects a missing email or business name', async () => {
    const res = await POST(request({ email: 'user@example.com' }))
    expect(res.status).toBe(400)
    expect(mocks.signInWithOtp).not.toHaveBeenCalled()
  })

  it('re-sends a fresh OTP when the email is registered but unverified', async () => {
    queueResult('client_portal_users', { data: { id: 'pu-1', client_id: 'c-1' }, error: null })
    queueResult('clients', { data: { email_verified_at: null }, error: null })

    const res = await POST(request(
      { email: 'User@Example.com', businessName: 'Acme Co' },
      { 'x-forwarded-for': 'ip-resend-ok' },
    ))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.resent).toBe(true)
    expect(body.needsVerification).toBe(true)
    expect(mocks.signInWithOtp).toHaveBeenCalledTimes(1)
    expect(mocks.signInWithOtp).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'user@example.com' }),
    )
    // Resend must not write to the DB at all — no inserts, updates, or deletes.
    expect(dbCalls.filter(c => ['insert', 'update', 'delete'].includes(c.method))).toHaveLength(0)
  })

  it('returns 429 when the resend hits the Supabase email cooldown', async () => {
    queueResult('client_portal_users', { data: { id: 'pu-1', client_id: 'c-1' }, error: null })
    queueResult('clients', { data: { email_verified_at: null }, error: null })
    mocks.signInWithOtp.mockResolvedValue({
      data: null,
      error: { message: 'For security purposes, you can only request this once every 60 seconds' },
    })

    const res = await POST(request(
      { email: 'user@example.com', businessName: 'Acme Co' },
      { 'x-forwarded-for': 'ip-cooldown' },
    ))
    expect(res.status).toBe(429)
  })

  it('throttles resend after 10 attempts from the same IP without reaching Supabase', async () => {
    for (let i = 0; i < 10; i++) {
      queueResult('client_portal_users', { data: { id: 'pu-1', client_id: 'c-1' }, error: null })
      queueResult('clients', { data: { email_verified_at: null }, error: null })
      const res = await POST(request(
        { email: 'user@example.com', businessName: 'Acme Co' },
        { 'x-forwarded-for': 'ip-throttle' },
      ))
      expect(res.status).toBe(200)
    }

    queueResult('client_portal_users', { data: { id: 'pu-1', client_id: 'c-1' }, error: null })
    queueResult('clients', { data: { email_verified_at: null }, error: null })
    const blocked = await POST(request(
      { email: 'user@example.com', businessName: 'Acme Co' },
      { 'x-forwarded-for': 'ip-throttle' },
    ))

    expect(blocked.status).toBe(429)
    // The 11th attempt must be cut off before the email-send call.
    expect(mocks.signInWithOtp).toHaveBeenCalledTimes(10)
  })

  it('returns 409 (never a resend) when the portal row has no clients record', async () => {
    // Dangling FK — client_portal_users row exists but its client is gone.
    // Re-sending would let the user verify into a missing workspace, so the
    // route deliberately refuses; the fix for this state is admin cleanup.
    queueResult('client_portal_users', { data: { id: 'pu-1', client_id: 'c-gone' }, error: null })
    queueResult('clients', NO_ROW)

    const res = await POST(request(
      { email: 'user@example.com', businessName: 'Acme Co' },
      { 'x-forwarded-for': 'ip-dangling' },
    ))

    expect(res.status).toBe(409)
    expect(mocks.signInWithOtp).not.toHaveBeenCalled()
  })

  it('returns 409 when the email belongs to an already-verified account', async () => {
    queueResult('client_portal_users', { data: { id: 'pu-1', client_id: 'c-1' }, error: null })
    queueResult('clients', { data: { email_verified_at: '2026-06-01T00:00:00Z' }, error: null })

    const res = await POST(request({ email: 'user@example.com', businessName: 'Acme Co' }))
    const body = await res.json()

    expect(res.status).toBe(409)
    expect(body.error).toMatch(/already exists/i)
    expect(mocks.signInWithOtp).not.toHaveBeenCalled()
  })

  it('returns 409 when the business name is taken by a different email', async () => {
    queueResult('client_portal_users', NO_ROW)
    queueResult('clients', { data: { id: 'other-client' }, error: null })

    const res = await POST(request({ email: 'new@example.com', businessName: 'Acme Co' }))
    const body = await res.json()

    expect(res.status).toBe(409)
    expect(body.error).toMatch(/business name/i)
    expect(mocks.signInWithOtp).not.toHaveBeenCalled()
  })

  it('creates client + portal rows BEFORE sending the OTP on a fresh signup', async () => {
    queueResult('client_portal_users', NO_ROW)                       // email check
    queueResult('clients', NO_ROW)                                   // name check
    queueResult('clients', { data: { id: 'c-new' }, error: null })   // insert
    queueResult('client_portal_users', { data: null, error: null })  // insert
    queueResult('public_scan_jobs', { data: null, error: null })     // scan bind lookup

    let insertsBeforeOtp = -1
    mocks.signInWithOtp.mockImplementation(() => {
      insertsBeforeOtp = dbCalls.filter(c => c.method === 'insert').length
      return Promise.resolve({ data: {}, error: null })
    })

    const res = await POST(request({
      email: 'new@example.com',
      businessName: 'Acme Co',
      websiteUrl: 'https://acme.com.au/about',
      next: '/dashboard',
    }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.clientId).toBe('c-new')
    expect(body.needsVerification).toBe(true)
    // Both DB rows existed before the email went out (rollback needs no listUsers).
    expect(insertsBeforeOtp).toBe(2)
    const clientInsert = dbCalls.find(c => c.table === 'clients' && c.method === 'insert')
    expect(clientInsert?.args[0]).toMatchObject({
      name: 'Acme Co',
      contact_email: 'new@example.com',
      domain: 'acme.com.au',
      source: 'self_serve',
    })
  })

  it('rolls back both rows when signInWithOtp fails', async () => {
    queueResult('client_portal_users', NO_ROW)
    queueResult('clients', NO_ROW)
    queueResult('clients', { data: { id: 'c-new' }, error: null })
    queueResult('client_portal_users', { data: null, error: null })
    mocks.signInWithOtp.mockResolvedValue({ data: null, error: { message: 'smtp down' } })

    const res = await POST(request({ email: 'new@example.com', businessName: 'Acme Co' }))

    expect(res.status).toBe(500)
    expect(dbCalls).toContainEqual(
      expect.objectContaining({ table: 'client_portal_users', method: 'delete' }),
    )
    expect(dbCalls).toContainEqual(
      expect.objectContaining({ table: 'clients', method: 'delete' }),
    )
  })

  it('rolls back the client when the portal-access insert fails', async () => {
    queueResult('client_portal_users', NO_ROW)
    queueResult('clients', NO_ROW)
    queueResult('clients', { data: { id: 'c-new' }, error: null })
    queueResult('client_portal_users', { data: null, error: { message: 'constraint violation' } })

    const res = await POST(request({ email: 'new@example.com', businessName: 'Acme Co' }))

    expect(res.status).toBe(500)
    expect(dbCalls).toContainEqual(
      expect.objectContaining({ table: 'clients', method: 'delete' }),
    )
    // OTP must never go out for a half-created account.
    expect(mocks.signInWithOtp).not.toHaveBeenCalled()
  })
})
