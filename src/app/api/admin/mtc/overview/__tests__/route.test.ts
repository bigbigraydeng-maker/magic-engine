/**
 * GET /api/admin/mtc/overview — unit tests [P-MTC.1]
 *
 * Verifies:
 * 1. Unauthenticated or non-whitelisted users get 401/403 via guardAdmin()
 * 2. Success returns totalBalanceMtc, totalRevenue, totalSoldMtc, totalConsumedMtc, clients
 * 3. clients[0] contains currentBalance and thisMonthSpend
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  guardAdmin: vi.fn(),
}))

vi.mock('@/lib/auth/require-admin', () => ({
  guardAdmin: mocks.guardAdmin,
}))

// ─── supabaseAdmin mock ───────────────────────────────────────────────────────
//
// The route runs multiple .from(...).select(...).eq(...) / .gte(...) / .in(...)
// chains.  We intercept at the `from` level, returning different results per
// table name so we can simulate each DB call independently.
//
// Chain calls (select, eq, gte, in, neq) all return the same proxy; the chain
// only resolves when `await`-ed (i.e. when `.then` is accessed).

const mockPurchases = vi.fn()
const mockLedger    = vi.fn()
const mockClients   = vi.fn()

function makeChainable(resolveFn: () => Promise<unknown>): object {
  const handler: ProxyHandler<object> = {
    get(_, prop) {
      if (prop === 'then') {
        // Must bind correctly so Promise.prototype.then runs with the right `this`
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
      // Every other accessor (select, eq, gte, gt, in, limit…) returns same proxy
      return () => new Proxy({}, handler)
    },
  }
  return new Proxy({}, handler)
}

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (table === 'mtc_purchases') return makeChainable(mockPurchases)
      if (table === 'mtc_ledger')    return makeChainable(mockLedger)
      if (table === 'clients')       return makeChainable(mockClients)
      return makeChainable(() => Promise.resolve({ data: [], error: null }))
    },
  },
}))

import { GET } from '../route'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

/** Valid (not-expired) purchases — used for balance / MTC metrics */
const STUB_PURCHASES = [
  { id: 'p1', client_id: 'c1', amount_nzd: 500, mtc_amount: 1000, mtc_remaining: 800 },
  { id: 'p2', client_id: 'c2', amount_nzd: 300, mtc_amount: 600,  mtc_remaining: 200 },
]

/**
 * All completed purchases (no expiry filter) — used for totalRevenue.
 * Includes one additional expired purchase (amount_nzd: 200) that should
 * be counted in revenue even though it no longer provides balance.
 */
const STUB_ALL_COMPLETED_PURCHASES = [
  { amount_nzd: 500 },
  { amount_nzd: 300 },
  { amount_nzd: 200 }, // expired batch — must still be counted in totalRevenue
]

const STUB_LEDGER = [
  { client_id: 'c1', direction: 'debit', mtc_amount: 100 },
  { client_id: 'c1', direction: 'debit', mtc_amount:  50 },
  { client_id: 'c2', direction: 'debit', mtc_amount:  80 },
]

const STUB_CLIENTS = [
  { id: 'c1', name: 'Client One' },
  { id: 'c2', name: 'Client Two' },
]

function makeRequest() {
  return new Request('http://localhost:3001/api/admin/mtc/overview')
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('GET /api/admin/mtc/overview', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // Default: guardAdmin passes (returns null)
    mocks.guardAdmin.mockResolvedValue(null)

    // purchases: two sequential calls per request
    //   1st call → valid (not-expired) purchases for balance/MTC metrics
    //   2nd call → all completed purchases for totalRevenue (no expiry filter)
    mockPurchases
      .mockResolvedValueOnce({ data: STUB_PURCHASES, error: null })
      .mockResolvedValueOnce({ data: STUB_ALL_COMPLETED_PURCHASES, error: null })
    mockLedger.mockResolvedValue({ data: STUB_LEDGER, error: null })
    mockClients.mockResolvedValue({ data: STUB_CLIENTS, error: null })
  })

  // ── Auth ──────────────────────────────────────────────────────────────────

  it('returns 401 when session is missing', async () => {
    mocks.guardAdmin.mockResolvedValue(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    )
    const res = await GET(makeRequest())
    expect(res.status).toBe(401)
  })

  it('returns 403 when user is not on the admin whitelist', async () => {
    mocks.guardAdmin.mockResolvedValue(
      NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    )
    const res = await GET(makeRequest())
    expect(res.status).toBe(403)
  })

  // ── Happy path ────────────────────────────────────────────────────────────

  it('returns 200 with required top-level fields', async () => {
    const res = await GET(makeRequest())
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(typeof json.totalBalanceMtc).toBe('number')
    expect(typeof json.totalRevenue).toBe('number')
    expect(typeof json.totalSoldMtc).toBe('number')
    expect(typeof json.totalConsumedMtc).toBe('number')
    expect(Array.isArray(json.clients)).toBe(true)
  })

  it('totalBalanceMtc equals sum of mtc_remaining across valid purchases', async () => {
    const res = await GET(makeRequest())
    const json = await res.json()
    // 800 + 200 = 1000
    expect(json.totalBalanceMtc).toBe(1000)
  })

  it('totalRevenue equals sum of amount_nzd across ALL completed purchases (including expired)', async () => {
    const res = await GET(makeRequest())
    const json = await res.json()
    // 500 + 300 + 200 (expired) = 1000
    expect(json.totalRevenue).toBe(1000)
  })

  it('totalSoldMtc equals sum of mtc_amount across valid purchases', async () => {
    const res = await GET(makeRequest())
    const json = await res.json()
    // 1000 + 600 = 1600
    expect(json.totalSoldMtc).toBe(1600)
  })

  it('totalConsumedMtc = totalSoldMtc - totalBalanceMtc', async () => {
    const res = await GET(makeRequest())
    const json = await res.json()
    expect(json.totalConsumedMtc).toBe(json.totalSoldMtc - json.totalBalanceMtc)
  })

  // ── clients array ─────────────────────────────────────────────────────────

  it('clients[0] has clientId, name, currentBalance, thisMonthSpend', async () => {
    const res = await GET(makeRequest())
    const json = await res.json()
    expect(json.clients.length).toBeGreaterThan(0)
    const first = json.clients[0]
    expect(typeof first.clientId).toBe('string')
    expect(typeof first.name).toBe('string')
    expect(typeof first.currentBalance).toBe('number')
    expect(typeof first.thisMonthSpend).toBe('number')
  })

  it('clients are sorted by currentBalance descending', async () => {
    const res = await GET(makeRequest())
    const json = await res.json()
    const balances: number[] = json.clients.map((c: { currentBalance: number }) => c.currentBalance)
    const sorted = [...balances].sort((a, b) => b - a)
    expect(balances).toEqual(sorted)
  })

  it('client name falls back to clientId.substring(0,8) when not found', async () => {
    mockClients.mockResolvedValue({ data: [], error: null })
    const res = await GET(makeRequest())
    const json = await res.json()
    for (const client of json.clients as Array<{ clientId: string; name: string }>) {
      expect(client.name).toBe(client.clientId.substring(0, 8))
    }
  })

  it('thisMonthSpend sums only debit ledger entries for each client', async () => {
    const res = await GET(makeRequest())
    const json = await res.json()
    const c1 = (json.clients as Array<{ clientId: string; thisMonthSpend: number }>)
      .find(c => c.clientId === 'c1')
    // c1 has two debit entries: 100 + 50 = 150
    expect(c1?.thisMonthSpend).toBe(150)
  })

  // ── Error handling ────────────────────────────────────────────────────────

  it('returns 500 when purchases DB query errors', async () => {
    // Reset the once-queue from beforeEach so the error takes effect on the first call
    mockPurchases.mockReset()
    mockPurchases.mockResolvedValue({ data: null, error: { message: 'DB failure' } })
    const res = await GET(makeRequest())
    expect(res.status).toBe(500)
  })

  it('returns 500 when ledger DB query errors', async () => {
    mockLedger.mockResolvedValue({ data: null, error: { message: 'DB failure' } })
    const res = await GET(makeRequest())
    expect(res.status).toBe(500)
  })
})
