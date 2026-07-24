/**
 * Tests for the campaign daily time series fetchers — P21.K.1
 *
 * These back the Ad Strategy Engine's data spine. The behaviour that matters
 * most here is pagination (the pre-existing getAdCampaignInsights silently
 * truncates at 10 campaigns) and faithful parsing of the fields the fatigue
 * judgement reads: ctr, frequency and results.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { getCampaignDailyInsights, getCampaignWindowFrequency } from '../client'

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

describe('getCampaignDailyInsights', () => {
  it('parses a day row into the shape the engine reads', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      data: [{
        campaign_id:   '120',
        campaign_name: 'CTS — Reborn',
        date_start:    '2026-07-13',
        spend:         '81.77',
        impressions:   '6097',
        reach:         '5395',
        clicks:        '150',
        frequency:     '1.13',
        cpm:           '13.41',
        actions: [
          { action_type: 'lead', value: '6' },
          { action_type: 'onsite_conversion.messaging_conversation_started_7d', value: '2' },
        ],
      }],
    }))

    const { rows } = await getCampaignDailyInsights(ACCOUNT, TOKEN, '2026-07-13', '2026-07-13')

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      campaign_id:  '120',
      insight_date: '2026-07-13',
      spend:        81.77,
      impressions:  6097,
      reach:        5395,
      frequency:    1.13,
      cpm:          13.41,
      leads:        6,
      messaging_conversations: 2,
      results:      8,
    })
    // CTR is clicks/impressions, stored as a fraction.
    expect(rows[0].ctr).toBeCloseTo(150 / 6097, 6)
    // cost_per_result = spend / results
    expect(rows[0].cost_per_result).toBeCloseTo(81.77 / 8, 6)
  })

  it('keeps ONE ctr metric per campaign — outbound_clicks_ctr never leaks in', async () => {
    // Lead Form / CTWA campaigns: Meta returns outbound_clicks_ctr on some days
    // (an order of magnitude smaller than click CTR) and omits it on others.
    // Preferring it when present mixed two metrics in one campaign's series and
    // broke the relative-baseline fatigue judgement. Both days below must come
    // out on the same clicks/impressions basis.
    fetchMock.mockResolvedValueOnce(jsonResponse({
      data: [
        {
          campaign_id: 'lead-form', date_start: '2026-07-13',
          spend: '30', impressions: '4000', clicks: '80',
          outbound_clicks_ctr: [{ action_type: 'outbound_click', value: '0.10' }],
        },
        {
          campaign_id: 'lead-form', date_start: '2026-07-14',
          spend: '30', impressions: '4000', clicks: '80',
        },
      ],
    }))

    const { rows } = await getCampaignDailyInsights(ACCOUNT, TOKEN, '2026-07-13', '2026-07-14')
    expect(rows[0].ctr).toBeCloseTo(80 / 4000, 6) // NOT 0.0010 from outbound
    expect(rows[1].ctr).toBeCloseTo(80 / 4000, 6)
    expect(rows[0].ctr).toBe(rows[1].ctr)
  })

  it('records a zero-click day as ctr 0, not a gap', async () => {
    // The baseline windows drop nulls; a served-but-unclicked day is the worst
    // day there is and must count against the campaign.
    fetchMock.mockResolvedValueOnce(jsonResponse({
      data: [
        { campaign_id: 'a', date_start: '2026-07-13', spend: '10', impressions: '2000', clicks: '0' },
        { campaign_id: 'a', date_start: '2026-07-14', spend: '0', impressions: '0', clicks: '0' },
      ],
    }))

    const { rows } = await getCampaignDailyInsights(ACCOUNT, TOKEN, '2026-07-13', '2026-07-14')
    expect(rows[0].ctr).toBe(0)     // impressions served, zero clicks
    expect(rows[1].ctr).toBeNull()  // nothing served — genuinely no data
  })

  it('follows pagination instead of truncating (the top-10 bug this replaces)', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({
        data:   [{ campaign_id: 'a', date_start: '2026-07-13', spend: '1', impressions: '10', clicks: '1' }],
        paging: { next: 'https://graph.facebook.com/next-page' },
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: [{ campaign_id: 'b', date_start: '2026-07-13', spend: '2', impressions: '20', clicks: '2' }],
      }))

    const { rows } = await getCampaignDailyInsights(ACCOUNT, TOKEN, '2026-07-13', '2026-07-13')

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(rows.map(r => r.campaign_id)).toEqual(['a', 'b'])
  })

  it('requests a daily breakdown, not a single aggregate', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: [] }))

    await getCampaignDailyInsights(ACCOUNT, TOKEN, '2026-06-21', '2026-07-20')

    const url = fetchMock.mock.calls[0][0] as string
    expect(url).toContain('time_increment=1')
    expect(url).toContain('level=campaign')
  })

  it('drops rows with no campaign_id or no date rather than writing junk', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      data: [
        { campaign_id: 'a', spend: '1' },                       // no date_start
        { date_start: '2026-07-13', spend: '1' },               // no campaign_id
        { campaign_id: 'c', date_start: '2026-07-13', spend: '3', impressions: '5', clicks: '1' },
      ],
    }))

    const { rows } = await getCampaignDailyInsights(ACCOUNT, TOKEN, '2026-07-13', '2026-07-13')
    expect(rows.map(r => r.campaign_id)).toEqual(['c'])
  })

  it('returns rows gathered so far when a later page fails, flagged incomplete', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({
        data:   [{ campaign_id: 'a', date_start: '2026-07-13', spend: '1', impressions: '10', clicks: '1' }],
        paging: { next: 'https://graph.facebook.com/next-page' },
      }))
      .mockResolvedValueOnce(errorResponse(500))

    const { rows, complete } = await getCampaignDailyInsights(ACCOUNT, TOKEN, '2026-07-13', '2026-07-13')
    expect(rows.map(r => r.campaign_id)).toEqual(['a'])
    expect(complete).toBe(false)
  })

  it('flags incomplete rather than throwing when the request blows up', async () => {
    // An empty result and a failed request must not look the same: silence
    // would read as "this account ran nothing yesterday".
    fetchMock.mockRejectedValueOnce(new Error('network down'))
    await expect(
      getCampaignDailyInsights(ACCOUNT, TOKEN, '2026-07-13', '2026-07-13'),
    ).resolves.toEqual({ rows: [], complete: false })
  })

  it('does NOT double-count when parent+child action types both appear', async () => {
    // Meta returns `lead` (aggregate) AND `onsite_conversion.lead_grouped`
    // (its Instant-Form child) for the same submissions; likewise the two
    // messaging types overlap. Summing would inflate results up to 2×.
    fetchMock.mockResolvedValueOnce(jsonResponse({
      data: [{
        campaign_id: 'a', date_start: '2026-07-13',
        spend: '80', impressions: '5000', clicks: '150',
        actions: [
          { action_type: 'lead', value: '10' },
          { action_type: 'onsite_conversion.lead_grouped', value: '10' },
          { action_type: 'onsite_conversion.messaging_conversation_started_7d', value: '4' },
          { action_type: 'onsite_conversion.total_messaging_connection', value: '4' },
        ],
      }],
    }))

    const { rows } = await getCampaignDailyInsights(ACCOUNT, TOKEN, '2026-07-13', '2026-07-13')
    // 10 leads + 4 messaging = 14, NOT 20 + 8 = 28.
    expect(rows[0].leads).toBe(10)
    expect(rows[0].messaging_conversations).toBe(4)
    expect(rows[0].results).toBe(14)
  })

  it('falls back to the child action type when the parent is absent', async () => {
    // Some accounts report only `lead_grouped`, no aggregate `lead`.
    fetchMock.mockResolvedValueOnce(jsonResponse({
      data: [{
        campaign_id: 'a', date_start: '2026-07-13',
        spend: '80', impressions: '5000', clicks: '150',
        actions: [{ action_type: 'onsite_conversion.lead_grouped', value: '7' }],
      }],
    }))

    const { rows } = await getCampaignDailyInsights(ACCOUNT, TOKEN, '2026-07-13', '2026-07-13')
    expect(rows[0].leads).toBe(7)
  })

  it('counts zero results when there are no lead or messaging actions', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      data: [{
        campaign_id: 'a', date_start: '2026-07-13',
        spend: '50', impressions: '1000', clicks: '10',
        actions: [{ action_type: 'post_engagement', value: '99' }],
      }],
    }))

    const { rows } = await getCampaignDailyInsights(ACCOUNT, TOKEN, '2026-07-13', '2026-07-13')
    expect(rows[0].results).toBe(0)
    // No results means cost-per-result is undefined, not zero or Infinity.
    expect(rows[0].cost_per_result).toBeNull()
  })
})

describe('getCampaignWindowFrequency', () => {
  it('asks for the window itself, without a daily breakdown', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: [] }))

    await getCampaignWindowFrequency(ACCOUNT, TOKEN, '2026-07-14', '2026-07-20')

    const url = fetchMock.mock.calls[0][0] as string
    // Frequency is not additive across days — a daily breakdown would be wrong.
    expect(url).not.toContain('time_increment')
  })

  it('maps campaign id to its window frequency', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      data: [
        { campaign_id: 'a', frequency: '1.66' },
        { campaign_id: 'b', frequency: '2.36' },
      ],
    }))

    const map = await getCampaignWindowFrequency(ACCOUNT, TOKEN, '2026-07-14', '2026-07-20')
    expect(map.get('a')).toBeCloseTo(1.66, 6)
    expect(map.get('b')).toBeCloseTo(2.36, 6)
  })

  it('skips rows with a missing or unparseable frequency', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      data: [
        { campaign_id: 'a' },
        { campaign_id: 'b', frequency: 'not-a-number' },
        { campaign_id: 'c', frequency: '1.5' },
      ],
    }))

    const map = await getCampaignWindowFrequency(ACCOUNT, TOKEN, '2026-07-14', '2026-07-20')
    expect([...map.keys()]).toEqual(['c'])
  })

  it('returns an empty map rather than throwing on HTTP failure', async () => {
    fetchMock.mockResolvedValueOnce(errorResponse(400))
    const map = await getCampaignWindowFrequency(ACCOUNT, TOKEN, '2026-07-14', '2026-07-20')
    expect(map.size).toBe(0)
  })
})
