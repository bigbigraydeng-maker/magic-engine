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
const fetchAdsets = vi.fn()
const fetchWindow = vi.fn()
const upsert      = vi.fn()
const historyProbe = vi.fn()
const timezoneProbe = vi.fn()
const notFilters: unknown[][] = []

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
  getAdsetDailyInsights: async (...a: unknown[]) => asWalk(await fetchAdsets(...a)),
  getCampaignWindowFrequency: (...a: unknown[]) => fetchWindow(...a),
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: (table: string) => ({
      // 两张表两个探针，按表名分流：
      //   ad_daily_insights  → needsBackfill(): select('insight_date').eq('client_id', id)
      //     .eq('level', level).order(...).limit(1) → { data: [{insight_date}] }
      //     2026-09-14 起还可能多一个 .eq('ad_account_id', …) 与 .not('actions','is',null)；
      //     所有 eq 参数按顺序摊平传给 historyProbe（第 4 个仍是 level），not 记在 notFilters。
      //   ad_entity_snapshots → resolveAccountTimezone(): .eq('ad_account_id', …)
      //     .eq('level','account').order('captured_at',…).limit(1) → { data: [{timezone_name}] }
      select: () => {
        const probe = table === 'ad_entity_snapshots' ? timezoneProbe : historyProbe
        const eqs: unknown[] = []
        const chain = {
          eq: (...args: unknown[]) => { eqs.push(...args); return chain },
          not: (...args: unknown[]) => { notFilters.push(args); return chain },
          order: () => ({ limit: () => probe(...eqs) }),
        }
        return chain
      },
      upsert: (...a: unknown[]) => upsert(...a),
    }),
  },
}))

import {
  syncAdDailyInsights,
  syncAdsetDailyInsights,
  syncCampaignDailyInsights,
  BACKFILL_LOOKBACK_DAYS,
  DEFAULT_LOOKBACK_DAYS,
  requestWindow,
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
  fetchAdsets.mockReset()
  fetchWindow.mockReset()
  upsert.mockReset()
  historyProbe.mockReset()
  timezoneProbe.mockReset()
  // 默认「查不到账户快照」→ 回落 UTC，其余用例的窗口行为跟修复前一致。
  timezoneProbe.mockResolvedValue({ data: [], error: null })
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

// ── ads IMPACT 阶段 1 §2.2：广告组级 + 视频完播列 ────────────────────────────
const VIDEO = {
  video_3s_views: 745, video_thruplays: 723, video_p25: 725, video_p50: 714, video_p75: 260,
  video_p95: 128, video_p100: 122, video_avg_watch_seconds: 34,
  actions: [{ action_type: 'video_view', value: '745' }],
}

describe('syncAdsetDailyInsights', () => {
  it('写 level=adset，parent_id 是所属系列，历史探测按 adset 层级', async () => {
    historyProbe.mockResolvedValue(DEEP_HISTORY)
    fetchAdsets.mockResolvedValue([{ ...dayRow(), ...VIDEO, adset_id: 's1', adset_name: 'ThruPlay_物流_200/cbm' }])

    const res = await syncAdsetDailyInsights('client-1', 'act_1', 'tok', { withVideo: true })

    expect(res.success).toBe(true)
    expect(probedLevel()).toBe('adset')
    const [written] = upsert.mock.calls[0][0] as Array<Record<string, unknown>>
    expect(written).toMatchObject({ level: 'adset', entity_id: 's1', parent_id: 'c1', video_thruplays: 723, video_p95: 128 })
  })

  it('withVideo 未开（migration 还没 apply）→ 不带视频 9 列，老列照写', async () => {
    historyProbe.mockResolvedValue(DEEP_HISTORY)
    fetchAdsets.mockResolvedValue([{ ...dayRow(), ...VIDEO, adset_id: 's1', adset_name: 'x' }])

    await syncAdsetDailyInsights('client-1', 'act_1', 'tok')

    const [written] = upsert.mock.calls[0][0] as Array<Record<string, unknown>>
    expect(written).not.toHaveProperty('video_thruplays')
    expect(written).not.toHaveProperty('actions')
    expect(written).toMatchObject({ level: 'adset', spend: 80, leads: 6 })
  })

  it('系列级、广告级同样按 withVideo 决定带不带视频列', async () => {
    historyProbe.mockResolvedValue(DEEP_HISTORY)
    fetchDaily.mockResolvedValue([{ ...dayRow(), ...VIDEO }])
    fetchAds.mockResolvedValue([{ ...adRow(), ...VIDEO }])

    await syncCampaignDailyInsights('client-1', 'act_1', 'tok', { withVideo: true })
    await syncAdDailyInsights('client-1', 'act_1', 'tok')

    const campaignRow = (upsert.mock.calls[0][0] as Array<Record<string, unknown>>)[0]
    const adRowWritten = (upsert.mock.calls[1][0] as Array<Record<string, unknown>>)[0]
    expect(campaignRow).toMatchObject({ video_thruplays: 723 })
    expect(adRowWritten).not.toHaveProperty('video_thruplays')
  })
})

describe('needsBackfill 按账户判深度（2026-09-14 魏征复审 B2）', () => {
  it('深度探测带上本次同步的账户，并在写视频列时只认带 actions 的行', async () => {
    notFilters.length = 0
    historyProbe.mockResolvedValue(DEEP_HISTORY)
    fetchAdsets.mockResolvedValue([])

    await syncAdsetDailyInsights('client-1', 'act_2202695063810470', 'tok', { withVideo: true })

    expect(historyProbe.mock.calls[0]).toEqual(['client_id', 'client-1', 'level', 'adset', 'ad_account_id', 'act_2202695063810470'])
    expect(notFilters).toEqual([['actions', 'is', null]])
  })

  it('没开视频列时不加 actions 过滤（老行照常算历史）', async () => {
    notFilters.length = 0
    historyProbe.mockResolvedValue(DEEP_HISTORY)
    fetchDaily.mockResolvedValue([])

    await syncCampaignDailyInsights('client-1', 'act_1', 'tok')

    expect(historyProbe.mock.calls[0]).toEqual(['client_id', 'client-1', 'level', 'campaign', 'ad_account_id', 'act_1'])
    expect(notFilters).toEqual([])
  })
})

/**
 * 2026-09-23 事故：取数窗口按 UTC 算「昨天」，而 Meta 是按广告账户自己的时区切天。
 * Render 跑在 UTC，cron 17:00 UTC 触发时新西兰已是次日 05:00，09-23 明明是完整的一天，
 * 却因为 UTC 的「昨天」是 09-22 而从未被请求——CTS 两个账户当天 0 行，两个仍在投的广告组
 * 约 NZ$135 花费对引擎不可见。
 */
describe('requestWindow 按广告账户时区算「昨天」', () => {
  /** 事故当时那一刻：UTC 17:00，新西兰已经是 09-24 05:00（NZST = UTC+12）。 */
  const INCIDENT = new Date('2026-09-23T17:00:00Z')

  it('Pacific/Auckland：until 必须是 09-23（当地已完整的一天），不是 UTC 的 09-22', () => {
    const { since, until } = requestWindow(false, 'Pacific/Auckland', INCIDENT)

    expect(until).toBe('2026-09-23')
    // since 跟 until 同一个时区基准，不能一半 UTC 一半本地。
    expect(since).toBe('2026-09-17')
  })

  it('UTC 以西的账户不会被推到未来，也不会多要一天没跑完的数据', () => {
    // UTC 已是 09-24 02:00，但洛杉矶（PDT = UTC-7）还停在 09-23 19:00：
    // 09-23 当地还没过完，最后一个完整的一天是 09-22。
    const { since, until } = requestWindow(false, 'America/Los_Angeles', new Date('2026-09-24T02:00:00Z'))

    expect(until).toBe('2026-09-22')
    expect(since).toBe('2026-09-16')
    // 同一时刻 UTC 的答案是 09-23——本地还没跑完的那一天，不能要。
    expect(requestWindow(false, null, new Date('2026-09-24T02:00:00Z')).until).toBe('2026-09-23')
  })

  it('时区未知时回落 UTC，跟修复前行为一致（没有快照的账户不会更差）', () => {
    expect(requestWindow(false, null, INCIDENT)).toEqual({
      since: '2026-09-16', until: '2026-09-22', lookback: DEFAULT_LOOKBACK_DAYS,
    })
  })

  it('回填窗口用同一个时区基准，只有深度不同', () => {
    const { since, until, lookback } = requestWindow(true, 'Pacific/Auckland', INCIDENT)

    expect(until).toBe('2026-09-23')
    expect(since).toBe('2026-08-25')
    expect(lookback).toBe(BACKFILL_LOOKBACK_DAYS)
  })
})

describe('三个同步入口都把账户时区算进请求窗口', () => {
  const INCIDENT = new Date('2026-09-23T17:00:00Z')
  const AUCKLAND = { data: [{ timezone_name: 'Pacific/Auckland' }], error: null }

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(INCIDENT)
    // 历史深度要在假时钟设好之后再算：模块顶部的 DEEP_HISTORY 是按真实今天算的，
    // 假时钟回到 9 月后它就「比回填窗口浅」，会误走回填路径，窗口起点变成 30 天前
    historyProbe.mockResolvedValue(historyReachingBack(BACKFILL_LOOKBACK_DAYS + 10))
    timezoneProbe.mockResolvedValue(AUCKLAND)
    fetchDaily.mockResolvedValue([])
    fetchAds.mockResolvedValue([])
    fetchAdsets.mockResolvedValue([])
  })
  afterEach(() => vi.useRealTimers())

  it('系列级请求到 09-23', async () => {
    await syncCampaignDailyInsights('client-1', 'act_2775766642787274', 'tok')
    expect(fetchDaily.mock.calls[0].slice(2)).toEqual(['2026-09-17', '2026-09-23'])
  })

  it('广告级请求到 09-23', async () => {
    await syncAdDailyInsights('client-1', 'act_2775766642787274', 'tok')
    expect(fetchAds.mock.calls[0].slice(2)).toEqual(['2026-09-17', '2026-09-23'])
  })

  it('广告组级请求到 09-23', async () => {
    await syncAdsetDailyInsights('client-1', 'act_2775766642787274', 'tok')
    expect(fetchAdsets.mock.calls[0].slice(2)).toEqual(['2026-09-17', '2026-09-23'])
  })

  it('时区按广告账户查，不按客户查（共用账户也能查到）', async () => {
    await syncCampaignDailyInsights('client-1', 'act_2775766642787274', 'tok')
    expect(timezoneProbe.mock.calls[0]).toEqual(
      ['ad_account_id', 'act_2775766642787274', 'level', 'account'],
    )
  })

  it('快照读失败时回落 UTC，不让整次同步跟着挂', async () => {
    timezoneProbe.mockResolvedValue({ data: null, error: { message: 'boom' } })

    const res = await syncCampaignDailyInsights('client-1', 'act_1', 'tok')

    expect(res.success).toBe(true)
    expect(fetchDaily.mock.calls[0].slice(2)).toEqual(['2026-09-16', '2026-09-22'])
  })
})
