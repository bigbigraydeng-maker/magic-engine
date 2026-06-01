/**
 * Tests for GET /api/cron/anomaly-detector — P22.D.3
 *
 * Mocks: supabaseAdmin, AnomalyDetectorJob, global fetch
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mock supabaseAdmin ────────────────────────────────────────────────────────
// clients query: .from('clients').select('id')

const mockClientsSelect = vi.fn()

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn((table: string) => {
      if (table === 'clients') return { select: mockClientsSelect }
      return {}
    }),
  },
}))

// ── Mock AnomalyDetectorJob ───────────────────────────────────────────────────

const mockJobRun = vi.fn().mockResolvedValue([])

vi.mock('@/lib/flywheel/anomaly/AnomalyDetectorJob', () => ({
  AnomalyDetectorJob: vi.fn().mockImplementation(() => ({
    run: mockJobRun,
  })),
}))

// ── Mock global fetch (for proactive endpoint call) ───────────────────────────

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

// ── Helpers ───────────────────────────────────────────────────────────────────

const CRON_SECRET  = 'test-cron-secret'
const CLIENT_ID_1  = 'client-uuid-001'
const CLIENT_ID_2  = 'client-uuid-002'

function makeRequest(secret: string | null) {
  const headers: Record<string, string> = {}
  if (secret !== null) headers['authorization'] = `Bearer ${secret}`
  return new NextRequest('http://localhost:3001/api/cron/anomaly-detector', {
    method: 'GET',
    headers,
  })
}

function mockProactiveOk(advisoryCount = 1) {
  mockFetch.mockResolvedValue({
    ok:   true,
    json: () => Promise.resolve({ advisories: new Array(advisoryCount).fill({}) }),
  })
}

function mockProactiveFail(status = 502) {
  mockFetch.mockResolvedValue({
    ok:   false,
    status,
    text: () => Promise.resolve('Bad Gateway'),
  })
}

const MOCK_SIGNAL = {
  clientId:      CLIENT_ID_1,
  flywheel:      'ads' as const,
  metricKey:     'ads.account.spend',
  ruleId:        'ads.cpa.surge_30pct_mom',
  severity:      'high' as const,
  currentValue:  100,
  baselineValue: 50,
  pctChange:     100,
  sourceRef:     {},
  status:        'new' as const,
  detectedAt:    '2026-06-01T04:00:00.000Z',
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /api/cron/anomaly-detector — P22.D.3', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET          = CRON_SECRET
    process.env.NEXT_PUBLIC_APP_URL  = 'http://localhost:3001'

    // Default: one client
    mockClientsSelect.mockResolvedValue({
      data: [{ id: CLIENT_ID_1 }],
      error: null,
    })
    // Default: no signals fired
    mockJobRun.mockResolvedValue([])
  })

  // ── Auth ──────────────────────────────────────────────────────────────────

  it('returns 401 when authorization header is missing', async () => {
    const { GET } = await import('./route')
    const res = await GET(makeRequest(null))
    expect(res.status).toBe(401)
  })

  it('returns 401 when wrong secret is provided', async () => {
    const { GET } = await import('./route')
    const res = await GET(makeRequest('wrong-secret'))
    expect(res.status).toBe(401)
  })

  // ── Empty clients ─────────────────────────────────────────────────────────

  it('returns 200 with processed=0 when no clients exist', async () => {
    mockClientsSelect.mockResolvedValue({ data: [], error: null })

    const { GET } = await import('./route')
    const res  = await GET(makeRequest(CRON_SECRET))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.clients_processed).toBe(0)
    expect(json.total_signals).toBe(0)
    expect(mockJobRun).not.toHaveBeenCalled()
  })

  // ── No signals fired ──────────────────────────────────────────────────────

  it('does NOT call proactive endpoint when AnomalyDetectorJob fires no signals', async () => {
    mockJobRun.mockResolvedValue([])

    const { GET } = await import('./route')
    const res  = await GET(makeRequest(CRON_SECRET))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.total_signals).toBe(0)
    expect(json.total_advisories).toBe(0)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  // ── Signals fired → advisory ───────────────────────────────────────────────

  it('calls proactive endpoint when signals are fired', async () => {
    mockJobRun.mockResolvedValue([MOCK_SIGNAL])
    mockProactiveOk(1)

    const { GET } = await import('./route')
    const res  = await GET(makeRequest(CRON_SECRET))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.total_signals).toBe(1)
    expect(json.total_advisories).toBe(1)
    expect(mockFetch).toHaveBeenCalledOnce()
  })

  it('passes correct clientId and auth header to proactive endpoint', async () => {
    mockJobRun.mockResolvedValue([MOCK_SIGNAL])
    mockProactiveOk(1)

    const { GET } = await import('./route')
    await GET(makeRequest(CRON_SECRET))

    const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://localhost:3001/api/ai/zhugeliang/proactive')
    expect(options.method).toBe('POST')
    expect((options.headers as Record<string, string>)['authorization']).toBe(`Bearer ${CRON_SECRET}`)
    const body = JSON.parse(options.body as string) as { clientId: string }
    expect(body.clientId).toBe(CLIENT_ID_1)
  })

  // ── Multiple clients ──────────────────────────────────────────────────────

  it('processes multiple clients and tallies results', async () => {
    mockClientsSelect.mockResolvedValue({
      data: [{ id: CLIENT_ID_1 }, { id: CLIENT_ID_2 }],
      error: null,
    })
    // client 1 fires a signal → 2 advisories; client 2 → no signals
    mockJobRun
      .mockResolvedValueOnce([MOCK_SIGNAL])  // client 1
      .mockResolvedValueOnce([])             // client 2
    mockProactiveOk(2)

    const { GET } = await import('./route')
    const res  = await GET(makeRequest(CRON_SECRET))
    const json = await res.json()

    expect(json.clients_processed).toBe(2)
    expect(json.total_signals).toBe(1)
    expect(json.total_advisories).toBe(2)
    expect(json.failed).toBe(0)
    expect(mockFetch).toHaveBeenCalledOnce()  // only called for client 1
  })

  // ── Resilience ────────────────────────────────────────────────────────────

  it('continues to next client when AnomalyDetectorJob throws', async () => {
    mockClientsSelect.mockResolvedValue({
      data: [{ id: CLIENT_ID_1 }, { id: CLIENT_ID_2 }],
      error: null,
    })
    mockJobRun
      .mockRejectedValueOnce(new Error('DB timeout'))  // client 1 fails
      .mockResolvedValueOnce([])                       // client 2 ok

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { GET } = await import('./route')
    const res  = await GET(makeRequest(CRON_SECRET))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.clients_processed).toBe(2)
    expect(json.failed).toBe(1)
    expect(json.results[0].error).toBe('DB timeout')
    expect(json.results[1].error).toBeUndefined()

    consoleSpy.mockRestore()
  })

  it('returns advisories=0 when proactive endpoint returns non-200', async () => {
    mockJobRun.mockResolvedValue([MOCK_SIGNAL])
    mockProactiveFail(502)

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { GET } = await import('./route')
    const res  = await GET(makeRequest(CRON_SECRET))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.total_signals).toBe(1)
    expect(json.total_advisories).toBe(0)
    expect(json.failed).toBe(0)  // proactive failure is non-fatal

    consoleSpy.mockRestore()
  })

  it('returns advisories=0 when proactive fetch throws', async () => {
    mockJobRun.mockResolvedValue([MOCK_SIGNAL])
    mockFetch.mockRejectedValue(new Error('Network error'))

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { GET } = await import('./route')
    const res  = await GET(makeRequest(CRON_SECRET))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.total_advisories).toBe(0)

    consoleSpy.mockRestore()
  })
})
