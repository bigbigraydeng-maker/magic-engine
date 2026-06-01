/**
 * Tests for GET /api/cron/zhuge-recalculate — P24.B
 *
 * Mocks: supabaseAdmin, assembleZhugeInput, conductPriorityActions, persistZhugeActions
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mock supabaseAdmin ────────────────────────────────────────────────────────
// client_discovery query: .from('client_discovery').select('client_id').not('confirmed_at','is',null)

const mockDiscoverySelect = vi.fn()
const mockDiscoveryNot    = vi.fn()

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn((table: string) => {
      if (table === 'client_discovery') {
        return {
          select: vi.fn(() => ({ not: mockDiscoveryNot })),
        }
      }
      return {}
    }),
  },
}))

// ── Mock assembleZhugeInput ───────────────────────────────────────────────────

const mockAssemble = vi.fn()

vi.mock('@/lib/zhuge/assembler', () => ({
  assembleZhugeInput: (...args: unknown[]) => mockAssemble(...args),
}))

// ── Mock conductPriorityActions ───────────────────────────────────────────────

const mockConduct = vi.fn()

vi.mock('@/lib/zhuge/conductor', () => ({
  conductPriorityActions: (...args: unknown[]) => mockConduct(...args),
}))

// ── Mock persistZhugeActions ──────────────────────────────────────────────────

const mockPersist = vi.fn()

vi.mock('@/lib/zhuge/action-persister', () => ({
  persistZhugeActions: (...args: unknown[]) => mockPersist(...args),
}))

// ── Fixtures ──────────────────────────────────────────────────────────────────

const CRON_SECRET  = 'test-cron-secret'
const CLIENT_ID_1  = 'client-uuid-001'
const CLIENT_ID_2  = 'client-uuid-002'

const MOCK_ASSEMBLED = {
  input:             { context: 'mock' },
  discovery_id:      'discovery-1',
  diagnostic_run_id: 'run-1',
}

const MOCK_OUTPUT = {
  top_actions:    [{ rank: 1, dimension: 'seo', action_type: 'seo.fix', why_now: 'now' }],
  generated_at:   '2026-06-01T03:00:00Z',
  cost_usd:       0.01,
  input_tokens:   100,
  output_tokens:  200,
}

function makeRequest(secret: string | null) {
  const headers: Record<string, string> = {}
  if (secret !== null) headers['authorization'] = `Bearer ${secret}`
  return new NextRequest('http://localhost:3001/api/cron/zhuge-recalculate', {
    method: 'GET',
    headers,
  })
}

function setupDiscoveries(clientIds: string[]) {
  mockDiscoveryNot.mockResolvedValue({
    data:  clientIds.map((id) => ({ client_id: id })),
    error: null,
  })
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /api/cron/zhuge-recalculate — P24.B', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = CRON_SECRET

    // Default: one eligible client
    setupDiscoveries([CLIENT_ID_1])
    // Default: happy path
    mockAssemble.mockResolvedValue(MOCK_ASSEMBLED)
    mockConduct.mockResolvedValue(MOCK_OUTPUT)
    mockPersist.mockResolvedValue({ inserted: 1, idempotent: false, action_ids: ['a1'], session_key: 'abc123' })
  })

  // ── Auth ────────────────────────────────────────────────────────────────────

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

  // ── Empty client list ────────────────────────────────────────────────────────

  it('returns 200 with processed=0 when no clients have confirmed discovery', async () => {
    setupDiscoveries([])

    const { GET } = await import('./route')
    const res  = await GET(makeRequest(CRON_SECRET))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(json.clients_processed).toBe(0)
    expect(mockAssemble).not.toHaveBeenCalled()
  })

  // ── Happy path — single client ───────────────────────────────────────────────

  it('processes single client and returns ok result', async () => {
    const { GET } = await import('./route')
    const res  = await GET(makeRequest(CRON_SECRET))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(json.clients_processed).toBe(1)
    expect(json.ok).toBe(1)
    expect(json.skipped).toBe(0)
    expect(json.errors).toBe(0)
    expect(json.results[0]).toMatchObject({
      client_id:     CLIENT_ID_1,
      status:        'ok',
      actions_count: 1,
    })
  })

  it('calls assemble → conduct → persist in correct order with correct args', async () => {
    const { GET } = await import('./route')
    await GET(makeRequest(CRON_SECRET))

    // assembleZhugeInput receives supabase + clientId
    expect(mockAssemble).toHaveBeenCalledOnce()
    expect(mockAssemble.mock.calls[0][1]).toBe(CLIENT_ID_1)

    // conductPriorityActions receives assembled input
    expect(mockConduct).toHaveBeenCalledOnce()
    expect(mockConduct.mock.calls[0][0]).toEqual(MOCK_ASSEMBLED.input)

    // persistZhugeActions receives correct shape
    expect(mockPersist).toHaveBeenCalledOnce()
    expect(mockPersist.mock.calls[0][1]).toMatchObject({
      clientId:        CLIENT_ID_1,
      discoveryId:     MOCK_ASSEMBLED.discovery_id,
      diagnosticRunId: MOCK_ASSEMBLED.diagnostic_run_id,
      output:          MOCK_OUTPUT,
    })
  })

  // ── Multiple clients ─────────────────────────────────────────────────────────

  it('processes multiple clients sequentially and tallies correctly', async () => {
    setupDiscoveries([CLIENT_ID_1, CLIENT_ID_2])
    mockAssemble.mockResolvedValue(MOCK_ASSEMBLED)
    mockConduct.mockResolvedValue({ ...MOCK_OUTPUT, top_actions: [MOCK_OUTPUT.top_actions[0], MOCK_OUTPUT.top_actions[0]] })

    const { GET } = await import('./route')
    const res  = await GET(makeRequest(CRON_SECRET))
    const json = await res.json()

    expect(json.clients_processed).toBe(2)
    expect(json.ok).toBe(2)
    expect(json.errors).toBe(0)
    expect(mockAssemble).toHaveBeenCalledTimes(2)
    expect(mockConduct).toHaveBeenCalledTimes(2)
    expect(mockPersist).toHaveBeenCalledTimes(2)
  })

  // ── Skipped clients ─────────────────────────────────────────────────────────

  it('skips client when assembleZhugeInput throws NO_DISCOVERY', async () => {
    mockAssemble.mockRejectedValueOnce(new Error('NO_DISCOVERY'))

    const { GET } = await import('./route')
    const res  = await GET(makeRequest(CRON_SECRET))
    const json = await res.json()

    expect(json.ok).toBe(0)
    expect(json.skipped).toBe(1)
    expect(json.errors).toBe(0)
    expect(json.results[0]).toMatchObject({
      client_id: CLIENT_ID_1,
      status:    'skipped',
      error:     'NO_DISCOVERY',
    })
    // conduct and persist should NOT be called
    expect(mockConduct).not.toHaveBeenCalled()
    expect(mockPersist).not.toHaveBeenCalled()
  })

  it('skips client when assembleZhugeInput throws CLIENT_NOT_FOUND', async () => {
    mockAssemble.mockRejectedValueOnce(new Error('CLIENT_NOT_FOUND'))

    const { GET } = await import('./route')
    const res  = await GET(makeRequest(CRON_SECRET))
    const json = await res.json()

    expect(json.skipped).toBe(1)
    expect(json.errors).toBe(0)
    expect(json.results[0].status).toBe('skipped')
  })

  // ── Error clients ────────────────────────────────────────────────────────────

  it('marks client as error when conductPriorityActions throws, continues to next', async () => {
    setupDiscoveries([CLIENT_ID_1, CLIENT_ID_2])
    mockAssemble.mockResolvedValue(MOCK_ASSEMBLED)
    mockConduct
      .mockRejectedValueOnce(new Error('Claude API timeout'))  // client 1 fails
      .mockResolvedValueOnce(MOCK_OUTPUT)                      // client 2 ok

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { GET } = await import('./route')
    const res  = await GET(makeRequest(CRON_SECRET))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.clients_processed).toBe(2)
    expect(json.ok).toBe(1)
    expect(json.errors).toBe(1)
    expect(json.results[0]).toMatchObject({ client_id: CLIENT_ID_1, status: 'error', error: 'Claude API timeout' })
    expect(json.results[1]).toMatchObject({ client_id: CLIENT_ID_2, status: 'ok' })

    consoleSpy.mockRestore()
  })

  it('marks client as error when persistZhugeActions throws', async () => {
    mockPersist.mockRejectedValueOnce(new Error('DB insert failed'))

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { GET } = await import('./route')
    const res  = await GET(makeRequest(CRON_SECRET))
    const json = await res.json()

    expect(json.errors).toBe(1)
    expect(json.results[0]).toMatchObject({ status: 'error', error: 'DB insert failed' })

    consoleSpy.mockRestore()
  })

  // ── DB error loading discoveries ─────────────────────────────────────────────

  it('returns 500 when client_discovery query fails', async () => {
    mockDiscoveryNot.mockResolvedValue({
      data:  null,
      error: { message: 'relation does not exist' },
    })

    const { GET } = await import('./route')
    const res  = await GET(makeRequest(CRON_SECRET))
    const json = await res.json()

    expect(res.status).toBe(500)
    expect(json.error).toContain('relation does not exist')
  })
})
