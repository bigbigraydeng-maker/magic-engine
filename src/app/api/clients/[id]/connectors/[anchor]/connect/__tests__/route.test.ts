import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

// #1052 GA4 connector state-invariant fix (PM Gate Blocker 1): this generic
// "mark any connector as connected" endpoint used to accept anchor='ga4' and
// upsert status='connected' with zero verification — the exact bypass that
// let a bad/unauthorized property_id get marked 'connected', or silently
// clobber a working connector. 'ga4' is now excluded; GA4 has exactly one
// legitimate write path (setGa4Property(), reached only via
// /api/clients/[id]/ga4-properties or the OAuth callback's narrow
// single-candidate case).

const mocks = vi.hoisted(() => ({
  requireOnboardingClientAccess: vi.fn(),
  from: vi.fn(),
  upsertCalls: [] as Array<{ table: string; row: unknown }>,
}))

vi.mock('@/lib/auth/client-access', () => ({
  requireOnboardingClientAccess: mocks.requireOnboardingClientAccess,
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { from: mocks.from },
}))

vi.mock('@/lib/zhangqian/persistor', () => ({
  getLatestDiscovery: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/zhangqian/start-advanced-discovery', () => ({
  startAdvancedDiscovery: vi.fn(),
}))

import { POST } from '../route'

const CLIENT_ID = 'client-abc'

function adminAccess() {
  return { ok: true as const, user: { email: 'admin@test.com' }, role: 'admin' as const, allowedClientId: null }
}

function routeContext(anchor: string) {
  return { params: { id: CLIENT_ID, anchor } }
}

function makeRequest(anchor: string, body: unknown = {}) {
  return new NextRequest(`http://localhost:3001/api/clients/${CLIENT_ID}/connectors/${anchor}/connect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function mockConnectorsTable(prior: { status: string } | null = null) {
  mocks.from.mockImplementation((table: string) => {
    if (table !== 'client_connectors') throw new Error(`unexpected table: ${table}`)
    const readChain: Record<string, unknown> = {}
    ;['select', 'eq'].forEach((m) => { readChain[m] = vi.fn().mockReturnValue(readChain) })
    readChain.maybeSingle = vi.fn().mockResolvedValue({ data: prior })
    return {
      select: readChain.select,
      upsert: vi.fn((row: unknown) => {
        mocks.upsertCalls.push({ table, row })
        return Promise.resolve({ error: null })
      }),
    }
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.upsertCalls.length = 0
  mocks.requireOnboardingClientAccess.mockResolvedValue(adminAccess())
  mockConnectorsTable(null)
})

describe('POST /api/clients/[id]/connectors/[anchor]/connect', () => {
  it('refuses to mint an unverified social authorisation marker and supplies the real entry', async () => {
    const res = await POST(makeRequest('social'), routeContext('social'))
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.code).toBe('SOCIAL_REQUIRES_OAUTH')
    expect(body.href).toContain('section=social-connections')
    expect(mocks.from).not.toHaveBeenCalled()
  })
  it('rejects anchor=ga4 with the explicit GA4_REQUIRES_PROPERTY_VERIFICATION code — never touches the DB', async () => {
    const res = await POST(makeRequest('ga4', { config: { property_id: '550203806' } }), routeContext('ga4'))

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.success).toBe(false)
    expect(body.code).toBe('GA4_REQUIRES_PROPERTY_VERIFICATION')
    expect(typeof body.error).toBe('string')
    expect(body.error).toMatch(/ga4-properties/)
    expect(mocks.upsertCalls).toHaveLength(0)
  })

  it('rejects anchor=ga4 even with an unrelated/legitimate-looking config payload — no bypass via body shape', async () => {
    const res = await POST(
      makeRequest('ga4', { config: { property_id: '999999999', extra: 'ignored' } }),
      routeContext('ga4'),
    )

    expect(res.status).toBe(400)
    expect(mocks.upsertCalls).toHaveLength(0)
  })

  it.each(['gsc', 'google-ads', 'gbp', 'meta-ads', 'reviews'])(
    'anchor=%s is unaffected — still connects normally',
    async (anchor) => {
      const res = await POST(makeRequest(anchor, { config: { page_url: 'https://example.com' } }), routeContext(anchor))

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      const write = mocks.upsertCalls.find((c) => c.table === 'client_connectors')
      expect(write).toBeDefined()
      expect((write!.row as { anchor: string; status: string }).anchor).toBe(anchor)
      expect((write!.row as { anchor: string; status: string }).status).toBe('connected')
    },
  )

  it('anchor=publer is no longer a valid connector — generic 400, never touches the DB', async () => {
    const res = await POST(makeRequest('publer', { config: { publer_account_ids: { facebook: 'x' } } }), routeContext('publer'))

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/Unknown connector/)
    expect(mocks.upsertCalls).toHaveLength(0)
  })

  it('an unknown anchor (not ga4, not in VALID_ANCHORS) still gets the generic 400 — ga4 rejection does not swallow other validation', async () => {
    const res = await POST(makeRequest('not-a-real-anchor'), routeContext('not-a-real-anchor'))

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.code).toBeUndefined()
    expect(body.error).toMatch(/Unknown connector/)
  })

  it('returns 401/403 before ever reaching the ga4 check when the caller lacks access to this client', async () => {
    mocks.requireOnboardingClientAccess.mockResolvedValue({ ok: false, status: 403, error: 'Forbidden' })

    const res = await POST(makeRequest('ga4'), routeContext('ga4'))

    expect(res.status).toBe(403)
    expect(mocks.upsertCalls).toHaveLength(0)
  })
})
