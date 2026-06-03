/**
 * GET /api/mtc/ledger — unit tests [P-MTC.3]
 *
 * Auth: portal user (client_portal_users match) OR admin (guardAdmin returns null)
 *
 * Covers:
 * 1. clientId missing → 400
 * 2. Portal user accessing another client's ledger → 403
 * 3. Portal user accessing own clientId → 200 with correct shape
 * 4. Admin (guardAdmin returns null) can access any clientId → 200
 * 5. DB query failure → 500
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'
import { NextRequest } from 'next/server'

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  guardAdmin: vi.fn(),
}))

vi.mock('@/lib/auth/require-session', () => ({
  requireSession: mocks.requireSession,
}))

vi.mock('@/lib/auth/require-admin', () => ({
  guardAdmin: mocks.guardAdmin,
}))

// ─── supabaseAdmin mock ───────────────────────────────────────────────────────
//
// Two tables are queried:
//   client_portal_users  — check if email+clientId combo exists
//   mtc_ledger           — fetch paginated rows + count
//
// makeChainable wraps a resolve function so any chain of .select/.eq/.order/
// .range/.limit returns the same proxy, and only resolves when awaited.

const mockPortalUsers = vi.fn()
const mockLedger = vi.fn()

function makeChainable(resolveFn: () => Promise<unknown>): object {
  const handler: ProxyHandler<object> = {
    get(_, prop) {
      if (prop === 'then') {
        return (
          onFulfilled?: (value: unknown) => unknown,
          onRejected?: (reason: unknown) => unknown,
        ) => resolveFn().then(onFulfilled, onRejected)
      }
      if (prop === 'catch') {
        return (onRejected?: (reason: unknown) => unknown) =>
          resolveFn().catch(onRejected)
      }
      if (prop === 'finally') {
        return (onFinally?: () => void) => resolveFn().finally(onFinally)
      }
      return () => new Proxy({}, handler)
    },
  }
  return new Proxy({}, handler)
}

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (table === 'client_portal_users') return makeChainable(mockPortalUsers)
      if (table === 'mtc_ledger') return makeChainable(mockLedger)
      return makeChainable(() => Promise.resolve({ data: [], error: null }))
    },
  },
}))

import { GET } from '../route'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const PORTAL_EMAIL = 'portal@example.com'
const CLIENT_ID    = 'client-uuid-1234'
const OTHER_CLIENT = 'client-uuid-other'

const STUB_LEDGER_ROWS = [
  {
    id: 'row-1',
    direction: 'debit' as const,
    service_key: 'blog_generation',
    mtc_amount: 50,
    source: 'auto',
    notes: 'blog post',
    created_at: '2026-06-01T10:00:00Z',
  },
  {
    id: 'row-2',
    direction: 'credit' as const,
    service_key: 'topup',
    mtc_amount: 1000,
    source: 'stripe',
    notes: null,
    created_at: '2026-05-31T09:00:00Z',
  },
]

function makeRequest(params: { clientId?: string; page?: string } = {}) {
  const url = new URL('http://localhost:3001/api/mtc/ledger')
  if (params.clientId !== undefined) url.searchParams.set('clientId', params.clientId)
  if (params.page !== undefined) url.searchParams.set('page', params.page)
  return new NextRequest(url.toString())
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('GET /api/mtc/ledger', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // Default: valid portal session
    mocks.requireSession.mockResolvedValue({
      ok: true,
      user: { email: PORTAL_EMAIL },
    })

    // Default: guardAdmin rejects (not admin)
    mocks.guardAdmin.mockResolvedValue(
      NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    )

    // Default: portal user owns CLIENT_ID
    mockPortalUsers.mockResolvedValue({
      data: [{ client_id: CLIENT_ID }],
      error: null,
    })

    // Default: ledger returns stub rows + count
    mockLedger.mockResolvedValue({
      data: STUB_LEDGER_ROWS,
      error: null,
      count: 2,
    })
  })

  // ── 1. Missing clientId ────────────────────────────────────────────────────

  it('returns 400 when clientId is missing', async () => {
    const res = await GET(makeRequest())
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/clientId/)
  })

  // ── 2. Portal user accessing another client → 403 ─────────────────────────

  it('returns 403 when portal user does not own the clientId and is not admin', async () => {
    // No portal_users record for this email+OTHER_CLIENT combo
    mockPortalUsers.mockResolvedValue({ data: [], error: null })
    // guardAdmin still fails (not admin)
    mocks.guardAdmin.mockResolvedValue(
      NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    )

    const res = await GET(makeRequest({ clientId: OTHER_CLIENT }))
    expect(res.status).toBe(403)
  })

  // ── 3. Portal user accessing own clientId → 200 ───────────────────────────

  it('returns 200 with correct shape for portal user accessing own clientId', async () => {
    const res = await GET(makeRequest({ clientId: CLIENT_ID }))
    expect(res.status).toBe(200)
    const json = await res.json()

    expect(Array.isArray(json.rows)).toBe(true)
    expect(typeof json.total).toBe('number')
    expect(typeof json.page).toBe('number')
    expect(json.pageSize).toBe(20)
  })

  it('returns rows with correct fields', async () => {
    const res = await GET(makeRequest({ clientId: CLIENT_ID }))
    const json = await res.json()

    expect(json.rows.length).toBe(STUB_LEDGER_ROWS.length)
    const first = json.rows[0]
    expect(typeof first.id).toBe('string')
    expect(['debit', 'credit']).toContain(first.direction)
    expect(typeof first.service_key).toBe('string')
    expect(typeof first.mtc_amount).toBe('number')
    expect(typeof first.source).toBe('string')
    // notes can be string or null
    expect(first.notes === null || typeof first.notes === 'string').toBe(true)
    expect(typeof first.created_at).toBe('string')
  })

  it('returns page=0 by default', async () => {
    const res = await GET(makeRequest({ clientId: CLIENT_ID }))
    const json = await res.json()
    expect(json.page).toBe(0)
  })

  it('passes through page parameter', async () => {
    const res = await GET(makeRequest({ clientId: CLIENT_ID, page: '2' }))
    const json = await res.json()
    expect(json.page).toBe(2)
  })

  // ── 4. Admin bypasses portal check ────────────────────────────────────────

  it('returns 200 for admin even without a portal_users record', async () => {
    // No portal record
    mockPortalUsers.mockResolvedValue({ data: [], error: null })
    // guardAdmin passes (returns null)
    mocks.guardAdmin.mockResolvedValue(null)

    const res = await GET(makeRequest({ clientId: OTHER_CLIENT }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(Array.isArray(json.rows)).toBe(true)
  })

  // ── 5. DB error → 500 ─────────────────────────────────────────────────────

  it('returns 500 when ledger DB query fails', async () => {
    mockLedger.mockResolvedValue({ data: null, error: { message: 'DB failure' }, count: null })

    const res = await GET(makeRequest({ clientId: CLIENT_ID }))
    expect(res.status).toBe(500)
  })

  // ── 6. Portal DB lookup failure → 500 (fail-closed) ──────────────────────

  it('returns 500 when portal user DB lookup fails (fail-closed)', async () => {
    mockPortalUsers.mockResolvedValue({ data: null, error: { message: 'connection timeout' } })

    const res = await GET(makeRequest({ clientId: CLIENT_ID }))
    expect(res.status).toBe(500)
    const json = await res.json()
    expect(json.error).toMatch(/Authorization check failed/)
  })

  // ── 7. Non-numeric page param → falls back to page 0 ─────────────────────

  it('handles non-numeric page param gracefully (falls back to page 0)', async () => {
    const res = await GET(makeRequest({ clientId: CLIENT_ID, page: 'abc' }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.page).toBe(0)
  })
})
