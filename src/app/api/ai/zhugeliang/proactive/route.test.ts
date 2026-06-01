/**
 * Tests for POST /api/ai/zhugeliang/proactive — P22.D.2
 *
 * Mocks: supabaseAdmin, @/lib/anthropic/client
 * Tests: auth, empty signals early-return, Claude success path,
 *        Claude failure, DB insert failure, signal acknowledgement.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mock supabaseAdmin ────────────────────────────────────────────────────────
//
// Query chain for anomaly_signals:
//   .from('anomaly_signals').select().eq(1).eq(2).order().limit()  → mockSignalsLimit
// Insert chain for execution_items:
//   .from('execution_items').insert().select()                      → mockItemsInsert
// Update chain for anomaly_signals acknowledge:
//   .from('anomaly_signals').update().in()                         → mockSignalUpdate

const mockSignalsLimit    = vi.fn()
const mockSignalsOrder    = vi.fn(() => ({ limit: mockSignalsLimit }))
const mockSignalsEq2      = vi.fn(() => ({ order: mockSignalsOrder }))
const mockSignalsEq1      = vi.fn(() => ({ eq: mockSignalsEq2 }))
const mockSignalsSelect   = vi.fn(() => ({ eq: mockSignalsEq1 }))

const mockItemsInsertSelect = vi.fn()
const mockItemsInsert       = vi.fn(() => ({ select: mockItemsInsertSelect }))

const mockSignalUpdateIn  = vi.fn()
const mockSignalUpdate    = vi.fn(() => ({ in: mockSignalUpdateIn }))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn((table: string) => {
      if (table === 'anomaly_signals') {
        return {
          select: mockSignalsSelect,
          update: mockSignalUpdate,
        }
      }
      if (table === 'execution_items') {
        return { insert: mockItemsInsert }
      }
      return {}
    }),
  },
}))

// ── Mock @/lib/anthropic/client ───────────────────────────────────────────────

const mockMessagesCreate = vi.fn()
const mockParseJson      = vi.fn()

vi.mock('@/lib/anthropic/client', () => ({
  MODEL_HAIKU:       'claude-haiku-4-5-20251001',
  getAnthropicClient: vi.fn(() => ({
    messages: { create: mockMessagesCreate },
  })),
  parseJsonResponse: (...args: unknown[]) => mockParseJson(...args),
}))

// ── Helpers ───────────────────────────────────────────────────────────────────

const CRON_SECRET = 'test-cron-secret'
const CLIENT_ID   = 'client-uuid-001'

function makeRequest(secret: string | null, body: unknown) {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (secret !== null) headers['authorization'] = `Bearer ${secret}`
  return new NextRequest('http://localhost:3001/api/ai/zhugeliang/proactive', {
    method:  'POST',
    headers,
    body:    JSON.stringify(body),
  })
}

const MOCK_SIGNAL = {
  id:             'signal-001',
  flywheel:       'ads',
  metric_key:     'ads.account.spend',
  rule_id:        'ads.cpa.surge_30pct_mom',
  severity:       'high',
  current_value:  100,
  baseline_value: 50,
  pct_change:     100,
  detected_at:    '2026-06-01T03:00:00.000Z',
}

const MOCK_ADVISORY = {
  title:       'Ads CPA doubled — pause underperforming ad sets',
  description: 'Cost per acquisition rose 100% month-over-month. Review and pause ad sets with CPA > $100.',
  dimension:   'ads',
  fix_type:    'third_party',
  severity:    'high',
  signal_ids:  ['signal-001'],
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/ai/zhugeliang/proactive — P22.D.2', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = CRON_SECRET

    // Defaults
    mockSignalsLimit.mockResolvedValue({ data: [], error: null })
    mockItemsInsertSelect.mockResolvedValue({ data: [{ id: 'item-001' }], error: null })
    mockSignalUpdateIn.mockResolvedValue({ error: null })
  })

  // ── Auth ──────────────────────────────────────────────────────────────────

  it('returns 401 when authorization header is missing', async () => {
    const { POST } = await import('./route')
    const res = await POST(makeRequest(null, { clientId: CLIENT_ID }))
    expect(res.status).toBe(401)
  })

  it('returns 401 when wrong secret is provided', async () => {
    const { POST } = await import('./route')
    const res = await POST(makeRequest('wrong', { clientId: CLIENT_ID }))
    expect(res.status).toBe(401)
  })

  it('returns 400 when clientId is missing', async () => {
    const { POST } = await import('./route')
    const res = await POST(makeRequest(CRON_SECRET, {}))
    expect(res.status).toBe(400)
  })

  // ── Early return — no signals ─────────────────────────────────────────────

  it('returns 200 with processed=0 when no new signals exist', async () => {
    mockSignalsLimit.mockResolvedValue({ data: [], error: null })

    const { POST } = await import('./route')
    const res  = await POST(makeRequest(CRON_SECRET, { clientId: CLIENT_ID }))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.processed).toBe(0)
    expect(json.advisories).toEqual([])
    expect(mockMessagesCreate).not.toHaveBeenCalled()
  })

  // ── Happy path ────────────────────────────────────────────────────────────

  it('calls Claude, writes execution_items, and acknowledges signals', async () => {
    mockSignalsLimit.mockResolvedValue({ data: [MOCK_SIGNAL], error: null })

    mockMessagesCreate.mockResolvedValue({
      content: [{ type: 'text', text: '{"advisories":[]}' }],
      usage:   { input_tokens: 100, output_tokens: 50 },
    })
    mockParseJson.mockReturnValue({ advisories: [MOCK_ADVISORY] })

    const { POST } = await import('./route')
    const res  = await POST(makeRequest(CRON_SECRET, { clientId: CLIENT_ID }))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.processed).toBe(1)
    expect(json.advisories).toHaveLength(1)
    expect(json.advisories[0].title).toBe(MOCK_ADVISORY.title)
    expect(json.signals_acknowledged).toBe(1)
    expect(mockItemsInsert).toHaveBeenCalledOnce()
    expect(mockSignalUpdate).toHaveBeenCalledOnce()
  })

  it('writes execution_items with source=proactive_signal', async () => {
    mockSignalsLimit.mockResolvedValue({ data: [MOCK_SIGNAL], error: null })
    mockMessagesCreate.mockResolvedValue({
      content: [{ type: 'text', text: '{}' }],
      usage:   { input_tokens: 100, output_tokens: 50 },
    })
    mockParseJson.mockReturnValue({ advisories: [MOCK_ADVISORY] })

    const { POST } = await import('./route')
    await POST(makeRequest(CRON_SECRET, { clientId: CLIENT_ID }))

    const insertCall = mockItemsInsert.mock.calls[0][0] as Array<{ source: string }>
    expect(insertCall[0].source).toBe('proactive_signal')
  })

  it('sets correct dimension and fix_type from Claude advisory', async () => {
    mockSignalsLimit.mockResolvedValue({ data: [MOCK_SIGNAL], error: null })
    mockMessagesCreate.mockResolvedValue({
      content: [{ type: 'text', text: '{}' }],
      usage:   { input_tokens: 100, output_tokens: 50 },
    })
    mockParseJson.mockReturnValue({ advisories: [MOCK_ADVISORY] })

    const { POST } = await import('./route')
    await POST(makeRequest(CRON_SECRET, { clientId: CLIENT_ID }))

    const row = (mockItemsInsert.mock.calls[0][0] as Array<Record<string, unknown>>)[0]
    expect(row.dimension).toBe('ads')
    expect(row.fix_type).toBe('third_party')
  })

  // ── Claude failure ────────────────────────────────────────────────────────

  it('returns 502 when Claude call throws', async () => {
    mockSignalsLimit.mockResolvedValue({ data: [MOCK_SIGNAL], error: null })
    mockMessagesCreate.mockRejectedValue(new Error('Claude API timeout'))

    const { POST } = await import('./route')
    const res  = await POST(makeRequest(CRON_SECRET, { clientId: CLIENT_ID }))

    expect(res.status).toBe(502)
    expect(mockItemsInsert).not.toHaveBeenCalled()
  })

  it('returns 200 with empty advisories when Claude returns no valid items', async () => {
    mockSignalsLimit.mockResolvedValue({ data: [MOCK_SIGNAL], error: null })
    mockMessagesCreate.mockResolvedValue({
      content: [{ type: 'text', text: '{}' }],
      usage:   { input_tokens: 50, output_tokens: 20 },
    })
    // Claude returns advisories but none pass validation
    mockParseJson.mockReturnValue({ advisories: [{ title: '', dimension: 'unknown', fix_type: 'bad' }] })

    const { POST } = await import('./route')
    const res  = await POST(makeRequest(CRON_SECRET, { clientId: CLIENT_ID }))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.advisories).toEqual([])
    expect(mockItemsInsert).not.toHaveBeenCalled()
  })

  // ── DB insert failure ─────────────────────────────────────────────────────

  it('returns 500 when execution_items insert fails', async () => {
    mockSignalsLimit.mockResolvedValue({ data: [MOCK_SIGNAL], error: null })
    mockMessagesCreate.mockResolvedValue({
      content: [{ type: 'text', text: '{}' }],
      usage:   { input_tokens: 100, output_tokens: 50 },
    })
    mockParseJson.mockReturnValue({ advisories: [MOCK_ADVISORY] })
    mockItemsInsertSelect.mockResolvedValue({ data: null, error: { message: 'constraint violation' } })

    const { POST } = await import('./route')
    const res = await POST(makeRequest(CRON_SECRET, { clientId: CLIENT_ID }))

    expect(res.status).toBe(500)
    expect(mockSignalUpdate).not.toHaveBeenCalled()
  })

  // ── Signal acknowledge failure is non-fatal ───────────────────────────────

  it('still returns 200 even when signal acknowledge fails', async () => {
    mockSignalsLimit.mockResolvedValue({ data: [MOCK_SIGNAL], error: null })
    mockMessagesCreate.mockResolvedValue({
      content: [{ type: 'text', text: '{}' }],
      usage:   { input_tokens: 100, output_tokens: 50 },
    })
    mockParseJson.mockReturnValue({ advisories: [MOCK_ADVISORY] })
    mockSignalUpdateIn.mockResolvedValue({ error: { message: 'FK violation' } })

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { POST } = await import('./route')
    const res = await POST(makeRequest(CRON_SECRET, { clientId: CLIENT_ID }))

    expect(res.status).toBe(200)
    expect(consoleSpy).toHaveBeenCalledWith(
      '[zhugeliang/proactive] signal acknowledge error:',
      'FK violation',
    )

    consoleSpy.mockRestore()
  })
})
