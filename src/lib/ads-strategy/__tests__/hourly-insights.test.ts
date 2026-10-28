/**
 * Tests for the ad-set HOURLY insights sync — `hourly-insights.ts`.
 *
 * Two things are worth pinning here:
 *   - the request window is anchored to the AD ACCOUNT's timezone and never
 *     includes today (a partial day would read as a collapse);
 *   - the upsert is chunked newest-day-first, so a half-written batch leaves
 *     its gap at the OLD edge — the only place the depth probe looks, and the
 *     probe judges by the EARLIEST stored day, so a shallow history re-backfills.
 *
 * The mocking shape mirrors __tests__/daily-insights.test.ts: the Meta fetcher
 * hands back a page walk ({ rows, complete }), and supabaseAdmin.from(table)
 * dispatches to a per-table probe.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const fetchHourly   = vi.fn()
const historyProbe  = vi.fn()
const timezoneProbe = vi.fn()
const upsert        = vi.fn()

vi.mock('@/lib/meta/adset-hourly-insights', () => ({
  getAdsetHourlyInsights: (...a: unknown[]) => fetchHourly(...a),
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: (table: string) => ({
      // Two tables, two probes, dispatched by name:
      //   ad_hourly_insights  → needsHourlyBackfill(): select('insight_date')
      //     .eq('client_id', id).eq('ad_account_id', acct)
      //     .order('insight_date', { ascending: true }).limit(1)  → EARLIEST stored day
      //   ad_entity_snapshots → resolveAccountTimezone(): select(...)
      //     .eq('ad_account_id', acct).eq('level', 'account')
      //     .order('captured_at', …).limit(1)
      select: () => {
        if (table === 'ad_entity_snapshots') {
          const eqs: unknown[] = []
          const chain = {
            eq: (...args: unknown[]) => { eqs.push(...args); return chain },
            order: () => ({ limit: () => timezoneProbe(...eqs) }),
          }
          return chain
        }
        const eqs: unknown[] = []
        const chain = {
          eq: (...args: unknown[]) => { eqs.push(...args); return chain },
          order: () => ({ limit: () => historyProbe(...eqs) }),
        }
        return chain
      },
      upsert: (...a: unknown[]) => upsert(...a),
    }),
  },
}))

import {
  hourlyRequestWindow,
  syncAdsetHourlyInsights,
  HOURLY_BACKFILL_LOOKBACK_DAYS,
  HOURLY_DEFAULT_LOOKBACK_DAYS,
} from '../hourly-insights'
import type { MetaAdsetHourlyRow } from '@/lib/meta/adset-hourly-insights'

const AUCKLAND = 'Pacific/Auckland'

/** A stored history whose oldest row is `daysAgo` old. */
function historyReachingBack(daysAgo: number) {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - daysAgo)
  return { data: [{ insight_date: d.toISOString().slice(0, 10) }], error: null }
}

const NO_HISTORY   = { data: [], error: null }
/** Deeper than the backfill window — nothing left to reach back for. */
const DEEP_HISTORY = historyReachingBack(HOURLY_BACKFILL_LOOKBACK_DAYS + 10)

function hourlyRow(overrides: Partial<MetaAdsetHourlyRow> = {}): MetaAdsetHourlyRow {
  return {
    adset_id:      'a1',
    adset_name:    'Group A',
    campaign_id:   'c1',
    campaign_name: 'C',
    insight_date:  '2026-10-27',
    hour:          9,
    spend:         4.54,
    impressions:   117,
    reach:         null,
    clicks:        5,
    frequency:     null,
    cpm:           38.8,
    ctr:           0.0427,
    cpc:           0.91,
    leads:         1,
    messaging_conversations: 0,
    results:       1,
    cost_per_result: 4.54,
    video_3s_views:  null,
    video_thruplays: null,
    video_p25:       null,
    video_p50:       null,
    video_p75:       null,
    video_p95:       null,
    video_p100:      null,
    video_avg_watch_seconds: null,
    actions:         null,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  historyProbe.mockResolvedValue(DEEP_HISTORY)
  timezoneProbe.mockResolvedValue({ data: [{ timezone_name: AUCKLAND }], error: null })
  upsert.mockResolvedValue({ error: null })
  fetchHourly.mockResolvedValue({ rows: [], complete: true })
})

afterEach(() => vi.useRealTimers())

describe('hourlyRequestWindow', () => {
  // 2026-10-28 10:00 UTC is 2026-10-28 23:00 in Auckland (NZDT = UTC+13),
  // so the account's "today" is 2026-10-28 and the last complete day is 10-27.
  const NOW = new Date('2026-10-28T10:00:00Z')

  it('steady-state window ends yesterday in the account timezone, 3 days deep', () => {
    const { since, until, lookback } = hourlyRequestWindow(false, AUCKLAND, NOW)

    expect(until).toBe('2026-10-27')
    expect(since).toBe('2026-10-25')
    expect(lookback).toBe(HOURLY_DEFAULT_LOOKBACK_DAYS)
  })

  it('backfill window uses the same anchor, 14 days deep', () => {
    const { since, until, lookback } = hourlyRequestWindow(true, AUCKLAND, NOW)

    expect(until).toBe('2026-10-27')
    expect(since).toBe('2026-10-14')
    expect(lookback).toBe(HOURLY_BACKFILL_LOOKBACK_DAYS)
  })

  it('never requests the account\'s today — until is strictly before it', () => {
    // Sweep a full UTC day so every possible "now" is covered; the account's
    // today moves at 11:00 UTC (midnight NZDT), and `until` must follow it
    // without ever landing on it.
    for (let h = 0; h < 24; h++) {
      const now = new Date(Date.UTC(2026, 9, 28, h, 0, 0))
      const { until } = hourlyRequestWindow(false, AUCKLAND, now)
      // The account's today is the day key of `now` in Auckland.
      const accountToday = new Intl.DateTimeFormat('en-CA', {
        timeZone: AUCKLAND, year: 'numeric', month: '2-digit', day: '2-digit',
      }).format(now)
      expect(until < accountToday).toBe(true)
    }
  })
})

describe('syncAdsetHourlyInsights', () => {
  it('backfills 14 days on the first run', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-28T10:00:00Z'))
    historyProbe.mockResolvedValue(NO_HISTORY)
    fetchHourly.mockResolvedValue({ rows: [hourlyRow()], complete: true })

    const res = await syncAdsetHourlyInsights('client-1', 'act_1', 'tok')

    expect(res.backfilled).toBe(true)
    expect(res.days_requested).toBe(HOURLY_BACKFILL_LOOKBACK_DAYS)
    const expected = hourlyRequestWindow(true, AUCKLAND, new Date('2026-10-28T10:00:00Z'))
    expect(fetchHourly.mock.calls[0]).toEqual(['act_1', 'tok', expected.since, expected.until])
  })

  it('pulls only the 3-day window once history exists', async () => {
    historyProbe.mockResolvedValue(DEEP_HISTORY)
    fetchHourly.mockResolvedValue({ rows: [hourlyRow()], complete: true })

    const res = await syncAdsetHourlyInsights('client-1', 'act_1', 'tok')

    expect(res.backfilled).toBe(false)
    expect(res.days_requested).toBe(HOURLY_DEFAULT_LOOKBACK_DAYS)
  })

  it('maps a Meta hourly row onto the ad_hourly_insights column set', async () => {
    historyProbe.mockResolvedValue(DEEP_HISTORY)
    fetchHourly.mockResolvedValue({ rows: [hourlyRow()], complete: true })

    const res = await syncAdsetHourlyInsights('client-1', 'act_1', 'tok')

    expect(res.success).toBe(true)
    expect(upsert).toHaveBeenCalledTimes(1)
    const [rows, opts] = upsert.mock.calls[0] as [Array<Record<string, unknown>>, unknown]
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      client_id:        'client-1',
      ad_account_id:    'act_1',
      platform:         'meta',
      level:            'adset',
      entity_id:        'a1',
      entity_name:      'Group A',
      parent_id:        'c1',
      insight_date:     '2026-10-27',
      hour:             9,
      account_timezone: AUCKLAND,
      spend:            4.54,
      results:          1,
    })
    expect(opts).toEqual({
      onConflict: 'client_id,platform,level,entity_id,insight_date,hour',
    })
  })

  it('chunks 1200 rows into 3 upserts, newest day first', async () => {
    historyProbe.mockResolvedValue(DEEP_HISTORY)
    // 1200 DISTINCT (ad set, day, hour) keys: 5 ad sets × 24 hours × 10 days.
    // Distinct on purpose — a real batch with a repeated key makes Postgres
    // reject the whole upsert ("cannot affect row a second time").
    const rows: MetaAdsetHourlyRow[] = Array.from({ length: 1200 }, (_, i) =>
      hourlyRow({
        adset_id:     `a${i % 5}`,
        hour:         Math.floor(i / 5) % 24,
        insight_date: `2026-10-${String(Math.floor(i / 120) + 1).padStart(2, '0')}`,
      }),
    )
    expect(new Set(rows.map(r => `${r.adset_id}|${r.insight_date}|${r.hour}`)).size).toBe(1200)
    fetchHourly.mockResolvedValue({ rows, complete: true })

    const res = await syncAdsetHourlyInsights('client-1', 'act_1', 'tok')

    expect(upsert).toHaveBeenCalledTimes(3)
    expect((upsert.mock.calls[0][0] as unknown[]).length).toBe(500)
    expect((upsert.mock.calls[2][0] as unknown[]).length).toBe(200)
    expect(res.rows_written).toBe(1200)

    // The safety property: if the run dies after chunk 1, the gap must land on
    // the OLDEST days. Every day in an earlier chunk is at least as new as every
    // day in a later chunk — removing the sort (input is oldest-first) breaks it.
    const dates = (call: number) => (upsert.mock.calls[call][0] as Array<Record<string, string>>).map(r => r.insight_date)
    const oldestOfFirst = [...dates(0)].sort()[0]
    const newestOfSecond = [...dates(1)].sort().reverse()[0]
    const oldestOfSecond = [...dates(1)].sort()[0]
    const newestOfLast = [...dates(2)].sort().reverse()[0]
    expect(oldestOfFirst >= newestOfSecond).toBe(true)
    expect(oldestOfSecond >= newestOfLast).toBe(true)
    expect(dates(0)[0]).toBe('2026-10-10')
  })

  it('writes nothing and reports success when Meta returns an empty complete walk', async () => {
    historyProbe.mockResolvedValue(DEEP_HISTORY)
    fetchHourly.mockResolvedValue({ rows: [], complete: true })

    const res = await syncAdsetHourlyInsights('client-1', 'act_1', 'tok')

    expect(res).toMatchObject({ success: true, rows_written: 0 })
    expect(upsert).not.toHaveBeenCalled()
  })

  it('does not pass a failed pull off as "no delivery"', async () => {
    historyProbe.mockResolvedValue(DEEP_HISTORY)
    fetchHourly.mockResolvedValue({ rows: [], complete: false })

    const res = await syncAdsetHourlyInsights('client-1', 'act_1', 'tok')

    expect(res.success).toBe(false)
    expect(res.rows_written).toBe(0)
    expect(res.error).toBeTruthy()
  })

  it('surfaces a db upsert error as {success:false} without throwing', async () => {
    historyProbe.mockResolvedValue(DEEP_HISTORY)
    fetchHourly.mockResolvedValue({ rows: [hourlyRow()], complete: true })
    upsert.mockResolvedValue({ error: { message: 'relation does not exist' } })

    const res = await syncAdsetHourlyInsights('client-1', 'act_1', 'tok')

    expect(res.success).toBe(false)
    expect(res.error).toContain('relation does not exist')
  })

  it('degrades to {success:false} instead of throwing on fetch failure', async () => {
    historyProbe.mockResolvedValue(DEEP_HISTORY)
    fetchHourly.mockRejectedValue(new Error('meta 500'))

    const res = await syncAdsetHourlyInsights('client-1', 'act_1', 'tok')

    expect(res.success).toBe(false)
    expect(res.error).toContain('meta 500')
  })

  it('treats a failed history probe as "no backfill needed" so it does not deep-pull forever', async () => {
    historyProbe.mockResolvedValue({ data: null, error: { message: 'x' } })
    fetchHourly.mockResolvedValue({ rows: [hourlyRow()], complete: true })

    const res = await syncAdsetHourlyInsights('client-1', 'act_1', 'tok')

    expect(res.backfilled).toBe(false)
    expect(res.days_requested).toBe(HOURLY_DEFAULT_LOOKBACK_DAYS)
  })

  it('re-backfills when stored history is SHALLOW (a half-finished first run), not just when empty', async () => {
    // Only the last 2 days made it in; the old edge is missing.
    historyProbe.mockResolvedValue(historyReachingBack(2))
    fetchHourly.mockResolvedValue({ rows: [hourlyRow()], complete: true })

    const res = await syncAdsetHourlyInsights('client-1', 'act_1', 'tok')

    expect(res.backfilled).toBe(true)
    expect(res.days_requested).toBe(HOURLY_BACKFILL_LOOKBACK_DAYS)
  })

  it('does not backfill when history already reaches back to the backfill window', async () => {
    historyProbe.mockResolvedValue(historyReachingBack(HOURLY_BACKFILL_LOOKBACK_DAYS + 1))
    fetchHourly.mockResolvedValue({ rows: [hourlyRow()], complete: true })

    const res = await syncAdsetHourlyInsights('client-1', 'act_1', 'tok')

    expect(res.backfilled).toBe(false)
  })

  it('a refused deep backfill (0 rows, incomplete) retries the short window so recent days still land', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-28T10:00:00Z'))
    historyProbe.mockResolvedValue(NO_HISTORY)
    fetchHourly
      .mockResolvedValueOnce({ rows: [], complete: false })
      .mockResolvedValueOnce({ rows: [hourlyRow()], complete: true })

    const res = await syncAdsetHourlyInsights('client-1', 'act_1', 'tok')

    expect(fetchHourly).toHaveBeenCalledTimes(2)
    const short = hourlyRequestWindow(false, AUCKLAND, new Date('2026-10-28T10:00:00Z'))
    expect(fetchHourly.mock.calls[1]).toEqual(['act_1', 'tok', short.since, short.until])
    expect(res).toMatchObject({ success: true, rows_written: 1, backfilled: false, days_requested: HOURLY_DEFAULT_LOOKBACK_DAYS })
  })

  it('steady-state pull passes the 3-day window to Meta', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-28T10:00:00Z'))
    historyProbe.mockResolvedValue(DEEP_HISTORY)
    fetchHourly.mockResolvedValue({ rows: [hourlyRow()], complete: true })

    await syncAdsetHourlyInsights('client-1', 'act_1', 'tok')

    const expected = hourlyRequestWindow(false, AUCKLAND, new Date('2026-10-28T10:00:00Z'))
    expect(fetchHourly.mock.calls[0]).toEqual(['act_1', 'tok', expected.since, expected.until])
  })
})
