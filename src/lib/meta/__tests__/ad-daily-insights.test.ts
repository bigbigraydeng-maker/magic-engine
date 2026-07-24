/**
 * Tests for the AD-level daily time series fetcher — P21.K.7
 *
 * The campaign-level fetcher is covered in campaign-daily-insights.test.ts;
 * what matters here is what only exists one level down: the ad identity, the
 * campaign attribution that lets an ad be blamed for its parent's numbers, and
 * the fact that `level=ad` is actually what gets requested (asking Meta for
 * level=campaign with ad fields silently returns campaign rows).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { getAdDailyInsights } from '../client'

const ACCOUNT = 'act_123'
const TOKEN   = 'tok'

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response
}

function errorResponse(status: number): Response {
  return {
    ok: false,
    status,
    json: async () => ({}),
    text: async () => 'boom',
  } as unknown as Response
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('getAdDailyInsights', () => {
  it('requests ad level with a daily breakdown and the ad identity fields', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: [] }))

    await getAdDailyInsights(ACCOUNT, TOKEN, '2026-06-25', '2026-07-24')

    const url = decodeURIComponent(fetchMock.mock.calls[0][0] as string)
    expect(url).toContain('level=ad')
    expect(url).toContain('time_increment=1')
    expect(url).toContain('ad_id')
    expect(url).toContain('ad_name')
    // campaign_id still resolves at ad level — it is what makes attribution possible.
    expect(url).toContain('campaign_id')
    // Not requested at all: ctr is clicks/impressions everywhere since #637.
    expect(url).not.toContain('outbound_clicks_ctr')
  })

  it('parses an ad row with its campaign attribution', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      data: [{
        ad_id:         '2001',
        ad_name:       'Walnut clearance — website',
        campaign_id:   '120',
        campaign_name: 'Oztop — Lead Form Cold Broad',
        date_start:    '2026-07-17',
        spend:         '40.00',
        impressions:   '3000',
        reach:         '2800',
        clicks:        '90',
        frequency:     '1.07',
        cpm:           '13.33',
        // Present on purpose: #637 made clicks/impressions the single yardstick,
        // and the ad level must not quietly reintroduce the mixed one.
        outbound_clicks_ctr: [{ action_type: 'outbound_click', value: '1.20' }],
        actions: [{ action_type: 'lead', value: '2' }],
      }],
    }))

    const { rows } = await getAdDailyInsights(ACCOUNT, TOKEN, '2026-07-17', '2026-07-17')

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      ad_id:         '2001',
      ad_name:       'Walnut clearance — website',
      campaign_id:   '120',
      campaign_name: 'Oztop — Lead Form Cold Broad',
      insight_date:  '2026-07-17',
      spend:         40,
      impressions:   3000,
      reach:         2800,
      leads:         2,
      results:       2,
    })
    // 90 / 3000 — NOT the 1.20% outbound figure sitting in the same payload.
    expect(rows[0].ctr).toBeCloseTo(0.03, 6)
    expect(rows[0].cost_per_result).toBeCloseTo(20, 6)
  })

  it('falls back to the id when a name is missing', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      data: [{ ad_id: '2001', campaign_id: '120', date_start: '2026-07-17', spend: '1', impressions: '10', clicks: '1' }],
    }))

    const { rows } = await getAdDailyInsights(ACCOUNT, TOKEN, '2026-07-17', '2026-07-17')
    expect(rows[0].ad_name).toBe('2001')
    expect(rows[0].campaign_name).toBe('120')
  })

  it('leaves campaign attribution empty rather than inventing a parent', async () => {
    // A fabricated parent (e.g. reusing ad_id) would group the ad under a
    // campaign that does not exist; the sync layer stores '' as NULL.
    fetchMock.mockResolvedValueOnce(jsonResponse({
      data: [{ ad_id: '2001', date_start: '2026-07-17', spend: '1', impressions: '10', clicks: '1' }],
    }))

    const { rows } = await getAdDailyInsights(ACCOUNT, TOKEN, '2026-07-17', '2026-07-17')
    expect(rows[0].campaign_id).toBe('')
    expect(rows[0].campaign_name).toBe('')
  })

  it('drops rows with no ad_id or no date rather than writing junk', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      data: [
        { ad_id: 'a', spend: '1' },                                  // no date_start
        { campaign_id: '120', date_start: '2026-07-17', spend: '1' }, // no ad_id
        { ad_id: 'c', date_start: '2026-07-17', spend: '3', impressions: '5', clicks: '1' },
      ],
    }))

    const { rows } = await getAdDailyInsights(ACCOUNT, TOKEN, '2026-07-17', '2026-07-17')
    expect(rows.map(r => r.ad_id)).toEqual(['c'])
  })

  it('follows pagination — ad-level row counts are the ones that overflow a page', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({
        data:   [{ ad_id: 'a', campaign_id: '120', date_start: '2026-07-17', spend: '1', impressions: '10', clicks: '1' }],
        paging: { next: 'https://graph.facebook.com/next-page' },
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: [{ ad_id: 'b', campaign_id: '120', date_start: '2026-07-17', spend: '2', impressions: '20', clicks: '2' }],
      }))

    const { rows } = await getAdDailyInsights(ACCOUNT, TOKEN, '2026-07-17', '2026-07-17')

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(rows.map(r => r.ad_id)).toEqual(['a', 'b'])
  })

  it('flags the walk incomplete when a later page fails, keeping what it got', async () => {
    // The signal the sync layer needs: without it a half-fetched 30-day
    // backfill looks finished and the missing days are never requested again.
    fetchMock
      .mockResolvedValueOnce(jsonResponse({
        data:   [{ ad_id: 'a', campaign_id: '120', date_start: '2026-07-17', spend: '1', impressions: '10', clicks: '1' }],
        paging: { next: 'https://graph.facebook.com/next-page' },
      }))
      .mockResolvedValueOnce(errorResponse(500))

    const { rows, complete } = await getAdDailyInsights(ACCOUNT, TOKEN, '2026-07-17', '2026-07-17')
    expect(rows.map(r => r.ad_id)).toEqual(['a'])
    expect(complete).toBe(false)
  })

  it('reports complete on a clean walk', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: [] }))
    const walk = await getAdDailyInsights(ACCOUNT, TOKEN, '2026-07-17', '2026-07-17')
    expect(walk).toEqual({ rows: [], complete: true })
  })

  it('flags incomplete rather than throwing when the request blows up', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network down'))
    await expect(
      getAdDailyInsights(ACCOUNT, TOKEN, '2026-07-17', '2026-07-17'),
    ).resolves.toEqual({ rows: [], complete: false })
  })

  it('flags incomplete when the page cap truncates a still-paging account', async () => {
    // 25 × 500 rows is reachable on a 30-day ad-level backfill; silent
    // truncation would look exactly like a finished walk.
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    fetchMock.mockResolvedValue(jsonResponse({
      data:   [{ ad_id: 'a', campaign_id: '120', date_start: '2026-07-17', spend: '1', impressions: '10', clicks: '1' }],
      paging: { next: 'https://graph.facebook.com/next-page' },
    }))

    const { complete } = await getAdDailyInsights(ACCOUNT, TOKEN, '2026-07-17', '2026-07-17')

    expect(fetchMock).toHaveBeenCalledTimes(25)
    expect(complete).toBe(false)
  })

  it('applies the same action-type de-duplication as the campaign level', async () => {
    // Parent + child action types overlap; summing them would inflate results 2×.
    fetchMock.mockResolvedValueOnce(jsonResponse({
      data: [{
        ad_id: 'a', campaign_id: '120', date_start: '2026-07-17',
        spend: '80', impressions: '5000', clicks: '150',
        actions: [
          { action_type: 'lead', value: '10' },
          { action_type: 'onsite_conversion.lead_grouped', value: '10' },
        ],
      }],
    }))

    const { rows } = await getAdDailyInsights(ACCOUNT, TOKEN, '2026-07-17', '2026-07-17')
    expect(rows[0].leads).toBe(10)
    expect(rows[0].results).toBe(10)
  })
})
