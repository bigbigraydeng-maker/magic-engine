/**
 * google-ads/client — fetchAccountInsights unit tests
 *
 * Pins the day-row → window-aggregate math. Google Ads GAQL emits one row
 * per segments.date inside the requested window; the client function sums
 * cost_micros, impressions, clicks, conversions into account-level totals
 * and derives CTR / CPC / CPA from those sums (not from per-day averages,
 * which would skew under uneven spend).
 *
 * The route test (route.test.ts) covers the cron flow; this file targets
 * the math + the GAQL-shape assumptions in isolation.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fetchAccountInsights, type GoogleAdsCreds } from '../client'

const CREDS: GoogleAdsCreds = {
  developerToken: 'dev-token',
  clientId:       'cid',
  clientSecret:   'cs',
  refreshToken:   'rt',
  customerId:     '1234567890',
}

function mockFetchSequence(...handlers: Array<() => Response>) {
  let i = 0
  return vi.fn().mockImplementation(async () => handlers[i++]())
}

function tokenOk(): Response {
  return new Response(JSON.stringify({ access_token: 'at', expires_in: 3600, token_type: 'Bearer' }), {
    status: 200, headers: { 'content-type': 'application/json' },
  })
}

function searchOk(rows: Array<{ costMicros: string; impressions: string; clicks: string; conversions: number }>): Response {
  return new Response(JSON.stringify({ results: rows.map(r => ({ metrics: r })) }), {
    status: 200, headers: { 'content-type': 'application/json' },
  })
}

describe('fetchAccountInsights', () => {
  beforeEach(() => { vi.restoreAllMocks() })
  afterEach(() => { vi.restoreAllMocks() })

  it('sums daily rows into window totals and derives ctr / cpc / cpa from those sums', async () => {
    // 3 days, spend totals to $5.00 (5,000,000 micros), 10000 impressions,
    // 250 clicks, 5 conversions. Derived:
    //   ctr = 250/10000 = 0.025
    //   cpc = 5/250     = 0.02
    //   cpa = 5/5       = 1.0
    global.fetch = mockFetchSequence(
      tokenOk,
      () => searchOk([
        { costMicros: '2000000', impressions: '4000', clicks: '100', conversions: 2 },
        { costMicros: '2000000', impressions: '3500', clicks:  '80', conversions: 1 },
        { costMicros: '1000000', impressions: '2500', clicks:  '70', conversions: 2 },
      ]),
    ) as unknown as typeof fetch

    const out = await fetchAccountInsights(CREDS, 30)
    expect(out).not.toBeNull()
    expect(out!.spend).toBeCloseTo(5.0, 4)
    expect(out!.impressions).toBe(10000)
    expect(out!.clicks).toBe(250)
    expect(out!.conversions).toBe(5)
    expect(out!.ctr).toBeCloseTo(0.025, 5)
    expect(out!.cpc).toBeCloseTo(0.02, 5)
    expect(out!.cpa).toBeCloseTo(1.0, 5)
  })

  it('returns zero (not NaN) for derived rates when their denominators are zero', async () => {
    // No impressions / clicks / conversions in the window — division-by-zero guard
    global.fetch = mockFetchSequence(tokenOk, () => searchOk([])) as unknown as typeof fetch

    const out = await fetchAccountInsights(CREDS, 30)
    expect(out).not.toBeNull()
    expect(out!.spend).toBe(0)
    expect(out!.impressions).toBe(0)
    expect(out!.clicks).toBe(0)
    expect(out!.conversions).toBe(0)
    expect(out!.ctr).toBe(0)
    expect(out!.cpc).toBe(0)
    expect(out!.cpa).toBe(0)
    expect(Number.isFinite(out!.ctr)).toBe(true)
    expect(Number.isFinite(out!.cpc)).toBe(true)
    expect(Number.isFinite(out!.cpa)).toBe(true)
  })

  it('emits an ISO-date window of length lookbackDays', async () => {
    global.fetch = mockFetchSequence(tokenOk, () => searchOk([])) as unknown as typeof fetch
    const out = await fetchAccountInsights(CREDS, 7)
    expect(out!.period_start).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(out!.period_end).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    const start = Date.parse(out!.period_start)
    const end   = Date.parse(out!.period_end)
    const days  = Math.round((end - start) / (1000 * 60 * 60 * 24))
    expect(days).toBe(7)
  })

  it('returns null (not throw) when the API returns an HTTP error', async () => {
    global.fetch = mockFetchSequence(
      tokenOk,
      () => new Response('{"error":{"code":403,"message":"developer token unapproved"}}', {
        status: 403, headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof fetch

    const consoleErr = vi.spyOn(console, 'error').mockImplementation(() => {})
    const out = await fetchAccountInsights(CREDS, 30)
    expect(out).toBeNull()
    expect(consoleErr).toHaveBeenCalled()
  })

  it('returns null when fetch itself throws (network down)', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(tokenOk())
      .mockRejectedValueOnce(new Error('ECONNREFUSED')) as unknown as typeof fetch

    const consoleErr = vi.spyOn(console, 'error').mockImplementation(() => {})
    const out = await fetchAccountInsights(CREDS, 30)
    expect(out).toBeNull()
    expect(consoleErr).toHaveBeenCalled()
  })
})
