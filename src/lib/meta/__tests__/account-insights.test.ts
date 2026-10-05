import { afterEach, describe, expect, it, vi } from 'vitest'
import { getAdAccountInsightsResult } from '../account-insights'

afterEach(() => vi.unstubAllGlobals())

describe('getAdAccountInsightsResult', () => {
  it('distinguishes transport, HTTP, response parsing, and empty-data failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    await expect(getAdAccountInsightsResult('act_1', 'token', '2026-09-01', '2026-09-02'))
      .resolves.toEqual({ ok: false, failure: { kind: 'network_error' } })

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 429 })))
    await expect(getAdAccountInsightsResult('act_1', 'token', '2026-09-01', '2026-09-02'))
      .resolves.toEqual({ ok: false, failure: { kind: 'http_error', status: 429 } })

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{', { status: 200 })))
    await expect(getAdAccountInsightsResult('act_1', 'token', '2026-09-01', '2026-09-02'))
      .resolves.toEqual({ ok: false, failure: { kind: 'invalid_json' } })

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ data: [] })))
    await expect(getAdAccountInsightsResult('act_1', 'token', '2026-09-01', '2026-09-02'))
      .resolves.toEqual({ ok: false, failure: { kind: 'empty_data' } })
  })

  it('returns parsed insights on a successful response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ data: [{ spend: '12.5', impressions: '10', clicks: '2' }] })))
    const result = await getAdAccountInsightsResult('act_1', 'token', '2026-09-01', '2026-09-02')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.insights).toMatchObject({ spend: 12.5, impressions: 10, clicks: 2 })
  })
})
