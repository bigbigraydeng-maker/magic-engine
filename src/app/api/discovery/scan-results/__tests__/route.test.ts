import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}))

import { POST } from '../route'
import { supabaseAdmin } from '@/lib/supabase'

const mockFrom = vi.mocked(supabaseAdmin.from)

const CLIENT_ID = '11111111-1111-4111-8111-111111111111'
const TOKEN = 'test-discovery-token-abc123'

// Fixture · minimal valid competitor
const competitor = {
  competitor_name: 'Test Comp',
  scanned_at: '2026-07-10T09:30:00+12:00',
  source: 'plugin_manual' as const,
  positioning_oneliner: 'test',
  data_gaps: [],
}

function makeRequest(body: unknown, token?: string): NextRequest {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token !== undefined) headers['authorization'] = `Bearer ${token}`
  return new NextRequest('http://localhost:3001/api/discovery/scan-results', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers,
  })
}

function mockClientLookup(exists: boolean) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({
      data: exists ? { id: CLIENT_ID } : null,
      error: null,
    }),
  }
}

function mockUpsertOk() {
  return {
    upsert: vi.fn().mockResolvedValue({ error: null }),
  }
}

function mockUpsertFail(message: string) {
  return {
    upsert: vi.fn().mockResolvedValue({ error: { message } }),
  }
}

// Wire mockFrom based on table name (called sequentially in handler)
function wireDbTables(opts: {
  clientExists: boolean
  competitorsResult?: 'ok' | { error: string }
  marketResult?: 'ok' | { error: string }
  mediaResult?: 'ok' | { error: string }
}) {
  const chains: Record<string, unknown> = {
    clients: mockClientLookup(opts.clientExists),
    competitor_snapshots:
      opts.competitorsResult === 'ok' || !opts.competitorsResult
        ? mockUpsertOk()
        : mockUpsertFail(opts.competitorsResult.error),
    market_context_snapshots:
      opts.marketResult === 'ok' || !opts.marketResult
        ? mockUpsertOk()
        : mockUpsertFail(opts.marketResult.error),
    local_media_channels:
      opts.mediaResult === 'ok' || !opts.mediaResult
        ? mockUpsertOk()
        : mockUpsertFail(opts.mediaResult.error),
  }
  mockFrom.mockImplementation((table: string) => {
    return chains[table] as ReturnType<typeof supabaseAdmin.from>
  })
}

describe('POST /api/discovery/scan-results', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    process.env.DISCOVERY_API_TOKEN = TOKEN
  })

  it('returns 500 when DISCOVERY_API_TOKEN is not set', async () => {
    delete process.env.DISCOVERY_API_TOKEN
    const res = await POST(
      makeRequest({ client_id: CLIENT_ID }, TOKEN),
    )
    expect(res.status).toBe(500)
  })

  it('returns 401 when no authorization header', async () => {
    const res = await POST(makeRequest({ client_id: CLIENT_ID }))
    expect(res.status).toBe(401)
  })

  it('returns 401 when Bearer token is wrong', async () => {
    const res = await POST(makeRequest({ client_id: CLIENT_ID }, 'wrong-token'))
    expect(res.status).toBe(401)
  })

  it('returns 400 when body is malformed JSON', async () => {
    const res = await POST(makeRequest('{not json', TOKEN))
    expect(res.status).toBe(400)
  })

  it('returns 400 when schema validation fails', async () => {
    const res = await POST(
      makeRequest({ client_id: 'not-a-uuid', source: 'plugin_manual' }, TOKEN),
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('Schema validation failed')
    expect(body.details).toBeDefined()
  })

  it('returns 404 when client_id not found', async () => {
    wireDbTables({ clientExists: false })
    const res = await POST(
      makeRequest(
        {
          client_id: CLIENT_ID,
          scanned_at: '2026-07-10T09:00:00+12:00',
          source: 'plugin_manual',
          competitors: [],
          market_context: null,
          local_media_channels: [],
        },
        TOKEN,
      ),
    )
    expect(res.status).toBe(404)
  })

  it('returns 200 with correct written counts on full success', async () => {
    wireDbTables({ clientExists: true })
    const res = await POST(
      makeRequest(
        {
          client_id: CLIENT_ID,
          scanned_at: '2026-07-10T09:00:00+12:00',
          source: 'plugin_manual',
          competitors: [competitor, { ...competitor, competitor_name: 'Comp 2' }],
          market_context: null,
          local_media_channels: [],
        },
        TOKEN,
      ),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.written).toEqual({
      competitor_snapshots: 2,
      market_context_snapshots: 0,
      local_media_channels: 0,
    })
    expect(body.discovery_tab_url).toBe(`/dashboard/clients/${CLIENT_ID}/discovery`)
  })

  it('returns 207 when one table upsert fails but others succeed', async () => {
    wireDbTables({
      clientExists: true,
      competitorsResult: { error: 'duplicate key' },
    })
    const res = await POST(
      makeRequest(
        {
          client_id: CLIENT_ID,
          scanned_at: '2026-07-10T09:00:00+12:00',
          source: 'plugin_manual',
          competitors: [competitor],
          market_context: null,
          local_media_channels: [],
        },
        TOKEN,
      ),
    )
    expect(res.status).toBe(207)
    const body = await res.json()
    expect(body.error).toBe('Partial write failure')
    expect(body.details).toContain('competitors: duplicate key')
  })

  it('empty payload arrays still write 0 (idempotent no-op)', async () => {
    wireDbTables({ clientExists: true })
    const res = await POST(
      makeRequest(
        {
          client_id: CLIENT_ID,
          scanned_at: '2026-07-10T09:00:00+12:00',
          source: 'plugin_manual',
          competitors: [],
          market_context: null,
          local_media_channels: [],
        },
        TOKEN,
      ),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.written.competitor_snapshots).toBe(0)
    expect(body.written.market_context_snapshots).toBe(0)
    expect(body.written.local_media_channels).toBe(0)
  })
})
