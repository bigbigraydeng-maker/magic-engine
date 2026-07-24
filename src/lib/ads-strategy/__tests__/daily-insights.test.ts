/**
 * Tests for the ad_daily_insights sync orchestration — P21.K.1
 *
 * Covers the three behaviours that would silently corrupt the time series if
 * wrong: backfill-on-first-run, attaching the 7-day window frequency only to
 * the latest day, and per-client isolation (degrade, never throw).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const fetchDaily  = vi.fn()
const fetchAds    = vi.fn()
const fetchWindow = vi.fn()
const upsert      = vi.fn()
const countHead   = vi.fn()

vi.mock('@/lib/meta/client', () => ({
  getCampaignDailyInsights: (...a: unknown[]) => fetchDaily(...a),
  getAdDailyInsights: (...a: unknown[]) => fetchAds(...a),
  getCampaignWindowFrequency: (...a: unknown[]) => fetchWindow(...a),
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: () => ({
      // needsBackfill(): select(...).eq('client_id', id).eq('level', level) → { count }
      select: () => ({
        eq: (...clientEq: unknown[]) => ({
          eq: (...levelEq: unknown[]) => countHead(...clientEq, ...levelEq),
        }),
      }),
      upsert: (...a: unknown[]) => upsert(...a),
    }),
  },
}))

import {
  syncAdDailyInsights,
  syncCampaignDailyInsights,
  BACKFILL_LOOKBACK_DAYS,
  DEFAULT_LOOKBACK_DAYS,
} from '../daily-insights'

/** The level the backfill probe was scoped to on the Nth call. */
function probedLevel(call = 0): unknown {
  return countHead.mock.calls[call]?.[3]
}

function dayRow(overrides: Record<string, unknown> = {}) {
  return {
    campaign_id:  'c1',
    campaign_name: 'CTS — Reborn',
    insight_date: '2026-07-13',
    spend: 80, impressions: 5000, reach: 4400, clicks: 150,
    frequency: 1.13, cpm: 16, ctr: 0.03, cpc: 0.53,
    leads: 6, messaging_conversations: 2, results: 8, cost_per_result: 10,
    ...overrides,
  }
}

function adRow(overrides: Record<string, unknown> = {}) {
  return {
    ad_id:   'a1',
    ad_name: 'Walnut clearance — website',
    campaign_id:   'c1',
    campaign_name: 'Oztop — Lead Form Cold Broad',
    insight_date: '2026-07-17',
    spend: 40, impressions: 3000, reach: 2800, clicks: 90,
    frequency: 1.07, cpm: 13.33, ctr: 0.012, cpc: 0.44,
    leads: 2, messaging_conversations: 0, results: 2, cost_per_result: 20,
    ...overrides,
  }
}

beforeEach(() => {
  fetchDaily.mockReset()
  fetchAds.mockReset()
  fetchWindow.mockReset()
  upsert.mockReset()
  countHead.mockReset()
  upsert.mockResolvedValue({ error: null })
  fetchWindow.mockResolvedValue(new Map())
})

afterEach(() => vi.restoreAllMocks())

describe('syncCampaignDailyInsights', () => {
  it('backfills 30 days when the client has no rows yet', async () => {
    countHead.mockResolvedValue({ count: 0, error: null })
    fetchDaily.mockResolvedValue([dayRow()])

    const res = await syncCampaignDailyInsights('client-1', 'act_1', 'tok')

    expect(res.backfilled).toBe(true)
    expect(res.days_requested).toBe(BACKFILL_LOOKBACK_DAYS)
    expect(res.success).toBe(true)
  })

  it('pulls only the latest day once history exists', async () => {
    countHead.mockResolvedValue({ count: 42, error: null })
    fetchDaily.mockResolvedValue([dayRow()])

    const res = await syncCampaignDailyInsights('client-1', 'act_1', 'tok')

    expect(res.backfilled).toBe(false)
    expect(res.days_requested).toBe(DEFAULT_LOOKBACK_DAYS)
  })

  it('attaches 7-day window frequency to the latest day only', async () => {
    countHead.mockResolvedValue({ count: 5, error: null })
    fetchDaily.mockResolvedValue([
      dayRow({ insight_date: '2026-07-12' }),
      dayRow({ insight_date: '2026-07-13' }), // latest
    ])
    fetchWindow.mockResolvedValue(new Map([['c1', 1.9]]))

    await syncCampaignDailyInsights('client-1', 'act_1', 'tok')

    const payload = upsert.mock.calls[0][0] as Array<Record<string, unknown>>
    const older  = payload.find(r => r.insight_date === '2026-07-12')
    const latest = payload.find(r => r.insight_date === '2026-07-13')
    expect(latest?.frequency_7d).toBe(1.9)
    // The older day must NOT carry the window frequency — that would double-count.
    expect(older?.frequency_7d).toBeNull()
  })

  it('upserts on the entity+day key so a re-run updates in place', async () => {
    countHead.mockResolvedValue({ count: 5, error: null })
    fetchDaily.mockResolvedValue([dayRow()])

    await syncCampaignDailyInsights('client-1', 'act_1', 'tok')

    expect(upsert.mock.calls[0][1]).toEqual({
      onConflict: 'client_id,platform,level,entity_id,insight_date',
    })
  })

  it('writes nothing and reports success when Meta returns no rows', async () => {
    countHead.mockResolvedValue({ count: 5, error: null })
    fetchDaily.mockResolvedValue([])

    const res = await syncCampaignDailyInsights('client-1', 'act_1', 'tok')

    expect(res).toMatchObject({ success: true, rows_written: 0 })
    expect(upsert).not.toHaveBeenCalled()
    // No rows means the window frequency call is pointless — skip it.
    expect(fetchWindow).not.toHaveBeenCalled()
  })

  it('degrades to {success:false} instead of throwing on fetch failure', async () => {
    countHead.mockResolvedValue({ count: 5, error: null })
    fetchDaily.mockRejectedValue(new Error('meta 500'))

    const res = await syncCampaignDailyInsights('client-1', 'act_1', 'tok')
    expect(res.success).toBe(false)
    expect(res.error).toContain('meta 500')
  })

  it('surfaces a db upsert error as {success:false}', async () => {
    countHead.mockResolvedValue({ count: 5, error: null })
    fetchDaily.mockResolvedValue([dayRow()])
    upsert.mockResolvedValue({ error: { message: 'unique violation' } })

    const res = await syncCampaignDailyInsights('client-1', 'act_1', 'tok')
    expect(res).toMatchObject({ success: false, error: 'unique violation' })
  })

  it('does not backfill when the row-count probe itself errors', async () => {
    // A failed probe must not trigger a 30-day pull on every single run.
    countHead.mockResolvedValue({ count: null, error: { message: 'timeout' } })
    fetchDaily.mockResolvedValue([dayRow()])

    const res = await syncCampaignDailyInsights('client-1', 'act_1', 'tok')
    expect(res.backfilled).toBe(false)
    expect(res.days_requested).toBe(DEFAULT_LOOKBACK_DAYS)
  })

  it('scopes the backfill probe to campaign rows', async () => {
    countHead.mockResolvedValue({ count: 5, error: null })
    fetchDaily.mockResolvedValue([dayRow()])

    await syncCampaignDailyInsights('client-1', 'act_1', 'tok')
    expect(probedLevel()).toBe('campaign')
  })
})

describe('syncAdDailyInsights', () => {
  it('stores the ad as the entity, with its campaign as parent_id', async () => {
    countHead.mockResolvedValue({ count: 12, error: null })
    fetchAds.mockResolvedValue([adRow()])

    const res = await syncAdDailyInsights('client-1', 'act_1', 'tok')

    const payload = upsert.mock.calls[0][0] as Array<Record<string, unknown>>
    expect(res.success).toBe(true)
    expect(payload).toHaveLength(1)
    expect(payload[0]).toMatchObject({
      client_id:    'client-1',
      platform:     'meta',
      level:        'ad',
      entity_id:    'a1',
      entity_name:  'Walnut clearance — website',
      parent_id:    'c1',
      insight_date: '2026-07-17',
      spend:        40,
      results:      2,
    })
  })

  it('stores NULL rather than an empty parent when Meta omits the campaign', async () => {
    countHead.mockResolvedValue({ count: 12, error: null })
    fetchAds.mockResolvedValue([adRow({ campaign_id: '' })])

    await syncAdDailyInsights('client-1', 'act_1', 'tok')

    const payload = upsert.mock.calls[0][0] as Array<Record<string, unknown>>
    expect(payload[0].parent_id).toBeNull()
  })

  it('backfills 30 days even when campaign rows already exist', async () => {
    // The probe is level-scoped: campaign history must not mask a missing ad
    // history, or every existing client would start from a 7-day stub.
    countHead.mockResolvedValue({ count: 0, error: null })
    fetchAds.mockResolvedValue([adRow()])

    const res = await syncAdDailyInsights('client-1', 'act_1', 'tok')

    expect(probedLevel()).toBe('ad')
    expect(res.backfilled).toBe(true)
    expect(res.days_requested).toBe(BACKFILL_LOOKBACK_DAYS)
  })

  it('pulls only the recent window once ad history exists', async () => {
    countHead.mockResolvedValue({ count: 900, error: null })
    fetchAds.mockResolvedValue([adRow()])

    const res = await syncAdDailyInsights('client-1', 'act_1', 'tok')
    expect(res.backfilled).toBe(false)
    expect(res.days_requested).toBe(DEFAULT_LOOKBACK_DAYS)
  })

  it('leaves frequency_7d null and spends no extra Graph call on it', async () => {
    countHead.mockResolvedValue({ count: 12, error: null })
    fetchAds.mockResolvedValue([adRow()])

    await syncAdDailyInsights('client-1', 'act_1', 'tok')

    const payload = upsert.mock.calls[0][0] as Array<Record<string, unknown>>
    expect(payload[0].frequency_7d).toBeNull()
    // The 7-day window frequency is a campaign-level input only.
    expect(fetchWindow).not.toHaveBeenCalled()
  })

  it('upserts on the same key so level keeps ad and campaign rows apart', async () => {
    countHead.mockResolvedValue({ count: 12, error: null })
    fetchAds.mockResolvedValue([adRow()])

    await syncAdDailyInsights('client-1', 'act_1', 'tok')

    expect(upsert.mock.calls[0][1]).toEqual({
      onConflict: 'client_id,platform,level,entity_id,insight_date',
    })
  })

  it('writes nothing and reports success when Meta returns no ads', async () => {
    countHead.mockResolvedValue({ count: 12, error: null })
    fetchAds.mockResolvedValue([])

    const res = await syncAdDailyInsights('client-1', 'act_1', 'tok')
    expect(res).toMatchObject({ success: true, rows_written: 0 })
    expect(upsert).not.toHaveBeenCalled()
  })

  it('degrades to {success:false} instead of throwing on fetch failure', async () => {
    countHead.mockResolvedValue({ count: 12, error: null })
    fetchAds.mockRejectedValue(new Error('meta 500'))

    const res = await syncAdDailyInsights('client-1', 'act_1', 'tok')
    expect(res.success).toBe(false)
    expect(res.error).toContain('meta 500')
  })

  it('surfaces a db upsert error as {success:false}', async () => {
    // Notably how a not-yet-applied parent_id migration shows up, rather than
    // silently dropping the column.
    countHead.mockResolvedValue({ count: 12, error: null })
    fetchAds.mockResolvedValue([adRow()])
    upsert.mockResolvedValue({ error: { message: "Could not find the 'parent_id' column" } })

    const res = await syncAdDailyInsights('client-1', 'act_1', 'tok')
    expect(res).toMatchObject({ success: false })
    expect(res.error).toContain('parent_id')
  })
})
