import { afterEach, describe, expect, it, vi } from 'vitest'
import { readLiveDeliveringProd } from '../deps'

const jsonResponse = (body: unknown, status = 200) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response

const ACCOUNT = { id: 'act_1', account_status: 1, currency: 'NZD', timezone_name: 'Pacific/Auckland' }
const resolveToken = async () => ({ token: 'tok-secret' })

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('production live read (default fetchers) — Codex P1/P2 on 3196', () => {
  it('P2: a paged adsets response is not followed — exactly 2 HTTP requests, falls back (null)', async () => {
    const mock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(ACCOUNT))
      .mockResolvedValueOnce(
        jsonResponse({
          data: [{ id: 'as1', effective_status: 'ACTIVE', daily_budget: '5000' }],
          paging: { next: 'https://graph.example/next' },
        }),
      )
      .mockResolvedValue(jsonResponse({ data: [] }))
    vi.stubGlobal('fetch', mock)
    const r = await readLiveDeliveringProd('c1', 'act_1', { resolveToken })
    expect(mock).toHaveBeenCalledTimes(2)
    expect(r).toBeNull()
  })

  it('P1: the adsets request asks for every delivering status the snapshot counts (incl. PENDING_BILLING_INFO) and the sum includes it', async () => {
    const mock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(ACCOUNT))
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            { id: 'as1', effective_status: 'ACTIVE', daily_budget: '5000' },
            { id: 'as2', effective_status: 'PENDING_BILLING_INFO', daily_budget: '3000' },
          ],
        }),
      )
    vi.stubGlobal('fetch', mock)
    const r = await readLiveDeliveringProd('c1', 'act_1', { resolveToken })
    const adsetsUrl = new URL(String(mock.mock.calls[1][0]))
    expect(adsetsUrl.searchParams.get('filtering')).toContain('PENDING_BILLING_INFO')
    expect(mock).toHaveBeenCalledTimes(2)
    expect(r?.minor).toBe(8000)
    expect(r?.incomplete).toBe(false)
  })
})
