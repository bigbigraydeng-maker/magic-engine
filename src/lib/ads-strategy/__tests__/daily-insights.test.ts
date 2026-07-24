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
const historyProbe = vi.fn()

/**
 * The fetchers return a page walk, not a bare array. Tests hand back a plain
 * array for the common "walk finished" case; passing {rows, complete:false}
 * explicitly is how a test opts into a truncated walk.
 */
function asWalk(value: unknown) {
  return Array.isArray(value) ? { rows: value, complete: true } : value
}

vi.mock('@/lib/meta/client', () => ({
  getCampaignDailyInsights: async (...a: unknown[]) => asWalk(await fetchDaily(...a)),
  getAdDailyInsights: async (...a: unknown[]) => asWalk(await fetchAds(...a)),
  getCampaignWindowFrequency: (...a: unknown[]) => fetchWindow(...a),
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: () => ({
      // needsBackfill(): select('insight_date').eq('client_id', id)
      //   .eq('level', level).order(...).limit(1) → { data: [{insight_date}] }
      select: () => ({
        eq: (...clientEq: unknown[]) => ({
          eq: (...levelEq: unknown[]) => ({
            order: () => ({ limit: () => historyProbe(...clientEq, ...levelEq) }),
          }),
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
  return historyProbe.mock.calls[call]?.[3]
}

/** A stored history whose oldest row is `daysAgo` old. */
function historyReachingBack(daysAgo: number) {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - daysAgo)
  return { data: [{ insight_date: d.toISOString().slice(0, 10) }], error: null }
}

const NO_HISTORY   = { data: [], error: null }
/** Deeper than the backfill window — nothing left to reach back for. */
const DEEP_HISTORY = historyReachingBack(BACKFILL_LOOKBACK_DAYS + 10)

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
  historyProbe.mockReset()
  upsert.mockResolvedValue({ error: null })
  fetchWindow.mockResolvedValue(new Map())
})

afterEach(() => vi.restoreAllMocks())

describe('syncCampaignDailyInsights', () => {
  it('backfills 30 days when the client has no rows yet', async () => {
    historyProbe.mockResolvedValue(NO_HISTORY)
    fetchDaily.mockResolvedValue([dayRow()])

    const res = await syncCampaignDailyInsights('client-1', 'act_1', 'tok')

    expect(res.backfilled).toBe(true)
    expect(res.days_requested).toBe(BACKFILL_LOOKBACK_DAYS)
    expect(res.success).toBe(true)
  })

  it('pulls only the latest day once history exists', async () => {
    historyProbe.mockResolvedValue(DEEP_HISTORY)
    fetchDaily.mockResolvedValue([dayRow()])

    const res = await syncCampaignDailyInsights('client-1', 'act_1', 'tok')

    expect(res.backfilled).toBe(false)
    expect(res.days_requested).toBe(DEFAULT_LOOKBACK_DAYS)
  })

  it('attaches 7-day window frequency to the latest day only', async () => {
    historyProbe.mockResolvedValue(DEEP_HISTORY)
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
    historyProbe.mockResolvedValue(DEEP_HISTORY)
    fetchDaily.mockResolvedValue([dayRow()])

    await syncCampaignDailyInsights('client-1', 'act_1', 'tok')

    expect(upsert.mock.calls[0][1]).toEqual({
      onConflict: 'client_id,platform,level,entity_id,insight_date',
    })
  })

  it('writes nothing and reports success when Meta returns no rows', async () => {
    historyProbe.mockResolvedValue(DEEP_HISTORY)
    fetchDaily.mockResolvedValue([])

    const res = await syncCampaignDailyInsights('client-1', 'act_1', 'tok')

    expect(res).toMatchObject({ success: true, rows_written: 0 })
    expect(upsert).not.toHaveBeenCalled()
    // No rows means the window frequency call is pointless — skip it.
    expect(fetchWindow).not.toHaveBeenCalled()
  })

  it('degrades to {success:false} instead of throwing on fetch failure', async () => {
    historyProbe.mockResolvedValue(DEEP_HISTORY)
    fetchDaily.mockRejectedValue(new Error('meta 500'))

    const res = await syncCampaignDailyInsights('client-1', 'act_1', 'tok')
    expect(res.success).toBe(false)
    expect(res.error).toContain('meta 500')
  })

  it('surfaces a db upsert error as {success:false}', async () => {
    historyProbe.mockResolvedValue(DEEP_HISTORY)
    fetchDaily.mockResolvedValue([dayRow()])
    upsert.mockResolvedValue({ error: { message: 'unique violation' } })

    const res = await syncCampaignDailyInsights('client-1', 'act_1', 'tok')
    expect(res).toMatchObject({ success: false, error: 'unique violation' })
  })

  it('does not backfill when the row-count probe itself errors', async () => {
    // A failed probe must not trigger a 30-day pull on every single run.
    historyProbe.mockResolvedValue({ data: null, error: { message: 'timeout' } })
    fetchDaily.mockResolvedValue([dayRow()])

    const res = await syncCampaignDailyInsights('client-1', 'act_1', 'tok')
    expect(res.backfilled).toBe(false)
    expect(res.days_requested).toBe(DEFAULT_LOOKBACK_DAYS)
  })

  it('scopes the backfill probe to campaign rows', async () => {
    historyProbe.mockResolvedValue(DEEP_HISTORY)
    fetchDaily.mockResolvedValue([dayRow()])

    await syncCampaignDailyInsights('client-1', 'act_1', 'tok')
    expect(probedLevel()).toBe('campaign')
  })

  it('keeps a truncated walk but reports it, so the day is not silently short', async () => {
    historyProbe.mockResolvedValue(DEEP_HISTORY)
    fetchDaily.mockResolvedValue({ rows: [dayRow()], complete: false })

    const res = await syncCampaignDailyInsights('client-1', 'act_1', 'tok')

    expect(upsert).toHaveBeenCalledTimes(1)
    expect(res.rows_written).toBe(1)
    expect(res.success).toBe(false)
    expect(res.error).toContain('page walk stopped early')
  })

  it('re-requests the deep window while stored history is too shallow', async () => {
    // The self-healing property: whatever cut the last backfill short — a
    // truncated page walk, a chunked write that died halfway — leaves the
    // history shallow, and shallow means the deep window is asked for again.
    historyProbe.mockResolvedValue(historyReachingBack(3))
    fetchDaily.mockResolvedValue([dayRow()])

    const res = await syncCampaignDailyInsights('client-1', 'act_1', 'tok')

    expect(res.backfilled).toBe(true)
    expect(res.days_requested).toBe(BACKFILL_LOOKBACK_DAYS)
  })

  it('does not pass a failed pull off as "no delivery yesterday"', async () => {
    historyProbe.mockResolvedValue(DEEP_HISTORY)
    fetchDaily.mockResolvedValue({ rows: [], complete: false })

    const res = await syncCampaignDailyInsights('client-1', 'act_1', 'tok')
    expect(res.success).toBe(false)
    expect(res.rows_written).toBe(0)
  })
})

describe('syncAdDailyInsights', () => {
  it('stores the ad as the entity, with its campaign as parent_id', async () => {
    historyProbe.mockResolvedValue(DEEP_HISTORY)
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
    historyProbe.mockResolvedValue(DEEP_HISTORY)
    fetchAds.mockResolvedValue([adRow({ campaign_id: '' })])

    await syncAdDailyInsights('client-1', 'act_1', 'tok')

    const payload = upsert.mock.calls[0][0] as Array<Record<string, unknown>>
    expect(payload[0].parent_id).toBeNull()
  })

  it('backfills 30 days even when campaign rows already exist', async () => {
    // The probe is level-scoped: campaign history must not mask a missing ad
    // history, or every existing client would start from a 7-day stub.
    historyProbe.mockResolvedValue(NO_HISTORY)
    fetchAds.mockResolvedValue([adRow()])

    const res = await syncAdDailyInsights('client-1', 'act_1', 'tok')

    expect(probedLevel()).toBe('ad')
    expect(res.backfilled).toBe(true)
    expect(res.days_requested).toBe(BACKFILL_LOOKBACK_DAYS)
  })

  it('pulls only the recent window once ad history exists', async () => {
    historyProbe.mockResolvedValue(DEEP_HISTORY)
    fetchAds.mockResolvedValue([adRow()])

    const res = await syncAdDailyInsights('client-1', 'act_1', 'tok')
    expect(res.backfilled).toBe(false)
    expect(res.days_requested).toBe(DEFAULT_LOOKBACK_DAYS)
  })

  it('leaves frequency_7d null and spends no extra Graph call on it', async () => {
    historyProbe.mockResolvedValue(DEEP_HISTORY)
    fetchAds.mockResolvedValue([adRow()])

    await syncAdDailyInsights('client-1', 'act_1', 'tok')

    const payload = upsert.mock.calls[0][0] as Array<Record<string, unknown>>
    expect(payload[0].frequency_7d).toBeNull()
    // The 7-day window frequency is a campaign-level input only.
    expect(fetchWindow).not.toHaveBeenCalled()
  })

  it('upserts on the same key so level keeps ad and campaign rows apart', async () => {
    historyProbe.mockResolvedValue(DEEP_HISTORY)
    fetchAds.mockResolvedValue([adRow()])

    await syncAdDailyInsights('client-1', 'act_1', 'tok')

    expect(upsert.mock.calls[0][1]).toEqual({
      onConflict: 'client_id,platform,level,entity_id,insight_date',
    })
  })

  it('writes nothing and reports success when Meta returns no ads', async () => {
    historyProbe.mockResolvedValue(DEEP_HISTORY)
    fetchAds.mockResolvedValue([])

    const res = await syncAdDailyInsights('client-1', 'act_1', 'tok')
    expect(res).toMatchObject({ success: true, rows_written: 0 })
    expect(upsert).not.toHaveBeenCalled()
  })

  it('degrades to {success:false} instead of throwing on fetch failure', async () => {
    historyProbe.mockResolvedValue(DEEP_HISTORY)
    fetchAds.mockRejectedValue(new Error('meta 500'))

    const res = await syncAdDailyInsights('client-1', 'act_1', 'tok')
    expect(res.success).toBe(false)
    expect(res.error).toContain('meta 500')
  })

  it('surfaces a db upsert error as {success:false}', async () => {
    // Notably how a not-yet-applied parent_id migration shows up, rather than
    // silently dropping the column.
    historyProbe.mockResolvedValue(DEEP_HISTORY)
    fetchAds.mockResolvedValue([adRow()])
    upsert.mockResolvedValue({ error: { message: "Could not find the 'parent_id' column" } })

    const res = await syncAdDailyInsights('client-1', 'act_1', 'tok')
    expect(res).toMatchObject({ success: false })
    expect(res.error).toContain('parent_id')
  })

  it('keeps a truncated walk, and the shallow history brings the next run back', async () => {
    // Partial rows are worth keeping: the depth probe will notice the history
    // is short tomorrow and ask for the missing days again.
    historyProbe.mockResolvedValue(DEEP_HISTORY)
    fetchAds.mockResolvedValue({ rows: [adRow()], complete: false })

    const res = await syncAdDailyInsights('client-1', 'act_1', 'tok')

    expect(upsert).toHaveBeenCalledTimes(1)
    expect(res.rows_written).toBe(1)
    expect(res.success).toBe(false)
    expect(res.error).toContain('page walk stopped early')
  })

  it('backfills again while the ad history is shallower than the window', async () => {
    historyProbe.mockResolvedValue(historyReachingBack(2))
    fetchAds.mockResolvedValue([adRow()])

    const res = await syncAdDailyInsights('client-1', 'act_1', 'tok')

    expect(probedLevel()).toBe('ad')
    expect(res.backfilled).toBe(true)
    expect(res.days_requested).toBe(BACKFILL_LOOKBACK_DAYS)
  })

  it('chunks the upsert newest-day-first so a half-written batch stays detectable', async () => {
    historyProbe.mockResolvedValue(DEEP_HISTORY)
    // 30 days × 40 ads is the realistic backfill shape — well past one statement.
    fetchAds.mockResolvedValue(
      Array.from({ length: 1200 }, (_, i) =>
        adRow({ ad_id: `a${i % 40}`, insight_date: `2026-06-${String((i % 30) + 1).padStart(2, '0')}` })),
    )

    const res = await syncAdDailyInsights('client-1', 'act_1', 'tok')

    expect(upsert).toHaveBeenCalledTimes(3)
    expect((upsert.mock.calls[0][0] as unknown[]).length).toBe(500)
    expect((upsert.mock.calls[2][0] as unknown[]).length).toBe(200)
    expect(res.rows_written).toBe(1200)

    // Ordering is the safety property: if the run dies after chunk 1, the gap
    // must land on the OLDEST days — the only place the depth probe looks.
    const firstChunk = upsert.mock.calls[0][0] as Array<Record<string, string>>
    const lastChunk  = upsert.mock.calls[2][0] as Array<Record<string, string>>
    const oldestOfFirst = firstChunk.map(r => r.insight_date).sort()[0]
    const newestOfLast  = lastChunk.map(r => r.insight_date).sort().reverse()[0]
    expect(oldestOfFirst >= newestOfLast).toBe(true)
  })

  it('leaves the oldest days unwritten when a chunk fails, not the newest', async () => {
    historyProbe.mockResolvedValue(DEEP_HISTORY)
    fetchAds.mockResolvedValue(
      Array.from({ length: 600 }, (_, i) =>
        adRow({ ad_id: `a${i % 20}`, insight_date: `2026-06-${String((i % 30) + 1).padStart(2, '0')}` })),
    )
    upsert
      .mockResolvedValueOnce({ error: null })
      .mockResolvedValueOnce({ error: { message: 'statement timeout' } })

    const res = await syncAdDailyInsights('client-1', 'act_1', 'tok')

    expect(res).toMatchObject({ success: false, error: 'statement timeout' })
    // The surviving write is the newest slice, so tomorrow's depth probe still
    // sees a history that is too shallow and re-requests the rest.
    const written = upsert.mock.calls[0][0] as Array<Record<string, string>>
    expect(written.map(r => r.insight_date).sort()[0]).toBe('2026-06-06')
  })
})
