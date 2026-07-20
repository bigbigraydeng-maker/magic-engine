/**
 * Tests for the ad_daily_insights sync orchestration — P21.K.1
 *
 * Covers the three behaviours that would silently corrupt the time series if
 * wrong: backfill-on-first-run, attaching the 7-day window frequency only to
 * the latest day, and per-client isolation (degrade, never throw).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const fetchDaily  = vi.fn()
const fetchWindow = vi.fn()
const upsert      = vi.fn()
const countHead   = vi.fn()

vi.mock('@/lib/meta/client', () => ({
  getCampaignDailyInsights: (...a: unknown[]) => fetchDaily(...a),
  getCampaignWindowFrequency: (...a: unknown[]) => fetchWindow(...a),
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: () => ({
      // needsBackfill(): select(...).eq(...) → { count }
      select: () => ({ eq: (...a: unknown[]) => countHead(...a) }),
      upsert: (...a: unknown[]) => upsert(...a),
    }),
  },
}))

import {
  syncCampaignDailyInsights,
  BACKFILL_LOOKBACK_DAYS,
  DEFAULT_LOOKBACK_DAYS,
} from '../daily-insights'

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

beforeEach(() => {
  fetchDaily.mockReset()
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
})
