import { beforeEach, describe, expect, it, vi } from 'vitest'

const graph = vi.hoisted(() => ({
  fetchCampaignSettings: vi.fn(),
  fetchAdsetSettings: vi.fn(),
  fetchAdSettings: vi.fn(),
  getAdDailyInsights: vi.fn(),
  getAdsetDailyInsights: vi.fn(),
  getCampaignWindowFrequency: vi.fn(),
}))
vi.mock('@/lib/meta/entity-settings', () => ({
  fetchCampaignSettings: graph.fetchCampaignSettings,
  fetchAdsetSettings: graph.fetchAdsetSettings,
  fetchAdSettings: graph.fetchAdSettings,
}))
vi.mock('@/lib/meta/ad-insights', () => ({ getAdDailyInsights: graph.getAdDailyInsights }))
vi.mock('@/lib/meta/adset-insights', () => ({ getAdsetDailyInsights: graph.getAdsetDailyInsights }))
vi.mock('@/lib/meta/campaign-insights', () => ({ getCampaignWindowFrequency: graph.getCampaignWindowFrequency }))

import {
  dominantPage, judgeAsOf, LIVE_MAX_AD_ROWS, liveSection, runLiveRules, toDailyRow, type LiveData, type LiveRulesArgs,
} from '../live-rules'
import { renderRuleSection } from '@/lib/ads-strategy/rules/client-copy'
import { shiftDate } from '@/lib/ads-strategy/portfolio/diagnostics/context'
import type { DailyRow } from '@/lib/ads-strategy/portfolio/diagnostics/types'
import type { EntitySnapshotRow } from '@/lib/ads-strategy/portfolio/snapshot'
import type { MetaAdDailyRow } from '@/lib/meta/ad-insights'
import type { MetaAdsetDailyRow } from '@/lib/meta/adset-insights'

const UNTIL = '2026-09-24'
const PAGE = 'pg-own'
const ARGS: LiveRulesArgs = { clientId: 'c', adAccountId: 'act_1', token: 't', currency: 'NZD', timezone: 'Pacific/Auckland', windowUntil: UNTIL }

function snap(p: Partial<EntitySnapshotRow> & Pick<EntitySnapshotRow, 'level' | 'entity_id'>): EntitySnapshotRow {
  return {
    client_id: 'c', platform: 'meta', ad_account_id: 'act_1', entity_name: p.entity_id, campaign_id: null, adset_id: null,
    status: 'ACTIVE', effective_status: 'ACTIVE', objective: null, optimization_goal: null, destination_type: null,
    budget_level: null, daily_budget_minor: null, lifetime_budget_minor: null, currency: 'NZD', bid_strategy: null,
    special_ad_categories: [], smart_promotion_type: null, included_audience_ids: [], excluded_audience_ids: [],
    advantage_audience: null, targeting_relaxation: null, targeting_summary: null, learning_stage: null, ad_studies: [],
    creative_video_ids: [], creative_page_id: null, account_status: null, disable_reason: null, timezone_name: null,
    audience_subtype: null, audience_count_lower: null, audience_rule_object_ids: [], audience_rule_events: [],
    audience_retention_days: null, audience_created_at: null, shared_account: false, settings_hash: 'live',
    capture_reason: 'daily', source_updated_time: null, captured_at: '2026-09-25T00:00:00Z', ...p,
  }
}
const SNAPS = [
  snap({ level: 'campaign', entity_id: 'c1', budget_level: 'cbo' }),
  snap({ level: 'adset', entity_id: 'as1', campaign_id: 'c1', optimization_goal: 'LEAD_GENERATION', destination_type: 'ON_AD' }),
  snap({ level: 'ad', entity_id: 'old', campaign_id: 'c1', adset_id: 'as1', creative_page_id: PAGE }),
]

function days(from: string, to: string): string[] {
  const out: string[] = []
  for (let d = from; d <= to; d = shiftDate(d, 1)) out.push(d)
  return out
}
function adRow(id: string, date: string, spend: number, clicks: number, link: number, leads: number): DailyRow {
  return {
    level: 'ad', entity_id: id, parent_id: 'c1', insight_date: date, spend, impressions: 1000, reach: 800, clicks, leads,
    messaging_conversations: 0, video_thruplays: null,
    actions: [{ action_type: 'link_click', value: String(link) }, { action_type: 'lead', value: String(leads) }],
  }
}
function adsetRows(rows: DailyRow[]): DailyRow[] {
  const byDay = new Map<string, DailyRow>()
  for (const r of rows) {
    const cur = byDay.get(r.insight_date) ?? { ...r, level: 'adset', entity_id: 'as1', spend: 0, impressions: 0, clicks: 0, leads: 0, actions: [] }
    cur.spend += r.spend
    cur.impressions += r.impressions
    cur.clicks += r.clicks
    cur.leads += r.leads
    byDay.set(r.insight_date, cur)
  }
  return [...byDay.values()]
}
/** An old ad whose click rate halves from `badFrom` on (the D2 fatigue shape). */
function decayingAd(badFrom: string): DailyRow[] {
  return days('2026-08-28', UNTIL).map(d => (d < badFrom ? adRow('old', d, 20, 40, 20, 3) : adRow('old', d, 20, 20, 10, 1)))
}
function liveData(ad: DailyRow[], p: Partial<LiveData> = {}): LiveData {
  return { snapshots: SNAPS, adDaily: ad, daily: adsetRows(ad), settingChanges: [], frequency: new Map([['c1', 1.7]]), ...p }
}

describe('liveSection — the patrol\'s two-in-a-row rule, judged from one read', () => {
  it('decline visible as of both the last day and the day before → one self-serve card', () => {
    const section = liveSection(ARGS, liveData(decayingAd('2026-09-22')))
    expect(section.source).toBe('live')
    if (section.source !== 'live') return
    expect(section.dataDate).toBe(UNTIL)
    expect(section.adsChecked).toBe(1)
    expect(section.findings).toHaveLength(1)
    expect(section.findings[0].kind).toBe('fatigue')
    expect(section.findings[0].adName).toBe('old')
    // self-serve voice: something the owner can try, never "tell us" / "our team"
    expect(section.findings[0].action).not.toMatch(/告诉我们|我们会|团队/)
  })

  it('decline only as of the last day → no card (the day before did not hit)', () => {
    const data = liveData(decayingAd('2026-09-23'))
    expect(judgeAsOf(ARGS, data, UNTIL, PAGE).hits.map(h => h.code)).toEqual(['D2'])
    expect(judgeAsOf(ARGS, data, shiftDate(UNTIL, -1), PAGE).hits).toEqual([])
    const section = liveSection(ARGS, data)
    expect(section).toEqual({ source: 'live', dataDate: UNTIL, adsChecked: 1, findings: [] })
    expect(renderRuleSection(section)).toContain('看了 1 条在花钱的广告')
  })

  it('Meta updated_time inside the rule window feeds the "recently changed" gate → no card', () => {
    const section = liveSection(ARGS, liveData(decayingAd('2026-09-22'), {
      settingChanges: [{ level: 'ad', entity_id: 'old', captured_at: '2026-09-21T01:00:00Z' }],
    }))
    expect(section.source === 'live' && section.findings).toEqual([])
  })

  it('the "day before" judgement only sees data up to that day', () => {
    // With the last day removed, judging as of the last day has no data for it: the before-day result must not change.
    const full = liveData(decayingAd('2026-09-22'))
    const trimmed = liveData(decayingAd('2026-09-22').filter(r => r.insight_date < UNTIL))
    const before = shiftDate(UNTIL, -1)
    expect(judgeAsOf(ARGS, full, before, PAGE).hits).toEqual(judgeAsOf(ARGS, trimmed, before, PAGE).hits)
  })

  it('no dominant page → no ad-by-ad check, with the mixed-pages reason', () => {
    const snaps = [...SNAPS, snap({ level: 'ad', entity_id: 'other', campaign_id: 'c1', adset_id: 'as1', creative_page_id: 'pg-other' })]
    const ad = [...decayingAd('2026-09-22'), ...days('2026-08-28', UNTIL).map(d => adRow('other', d, 20, 40, 20, 3))]
    const section = liveSection(ARGS, liveData(ad, { snapshots: snaps }))
    expect(section).toEqual({ source: 'none', reason: 'mixed_pages' })
  })

  it('nothing spent in the window → checked zero ads, worded as "nothing suitable", not "no ads running"', () => {
    const ad = decayingAd('2026-09-22').map(r => ({ ...r, spend: 0 }))
    const section = liveSection(ARGS, liveData(ad))
    expect(section).toEqual({ source: 'live', dataDate: UNTIL, adsChecked: 0, findings: [] })
    const text = renderRuleSection(section)
    expect(text).toContain('没有适合逐条检查的广告')
    expect(text).not.toContain('没有正在投放')
  })
})

describe('dominantPage', () => {
  const pageSnaps = (pages: Record<string, string | null>) =>
    Object.entries(pages).map(([id, page]) => snap({ level: 'ad', entity_id: id, creative_page_id: page }))
  const spend = (id: string, amount: number): DailyRow => ({ ...adRow(id, UNTIL, amount, 0, 0, 0) })

  it('picks the page with ≥ 60% of spend', () => {
    expect(dominantPage([spend('a', 60), spend('b', 40)], pageSnaps({ a: 'p1', b: 'p2' }))).toBe('p1')
  })
  it('below 60% → null', () => {
    expect(dominantPage([spend('a', 59), spend('b', 41)], pageSnaps({ a: 'p1', b: 'p2' }))).toBeNull()
  })
  it('ads with no known page count towards the total but never win', () => {
    expect(dominantPage([spend('a', 55), spend('b', 45)], pageSnaps({ a: 'p1', b: null }))).toBeNull()
    expect(dominantPage([spend('a', 10), spend('b', 90)], pageSnaps({ a: 'p1', b: null }))).toBeNull()
  })
  it('no spend → no_spend', () => {
    expect(dominantPage([spend('a', 0)], pageSnaps({ a: 'p1' }))).toBe('no_spend')
  })
})

function metaRow(date: string, spend: number, clicks = 40, link = 20, leads = 3): MetaAdDailyRow {
  return {
    campaign_id: 'c1', campaign_name: 'C', insight_date: date, spend, impressions: 1000, reach: 800, clicks, frequency: 1.25,
    cpm: null, ctr: clicks / 1000, cpc: null, leads, messaging_conversations: 0, results: leads, cost_per_result: null, video_3s_views: null,
    video_thruplays: null, video_p25: null, video_p50: null, video_p75: null, video_p95: null, video_p100: null,
    video_avg_watch_seconds: null, actions: [{ action_type: 'link_click', value: String(link) }, { action_type: 'lead', value: String(leads) }],
    ad_id: 'old', ad_name: 'old',
  }
}

describe('toDailyRow', () => {
  it('ad rows keep the campaign id as parent (same as the patrol\'s stored rows)', () => {
    const row = toDailyRow('ad', 'old', metaRow(UNTIL, 20))
    expect(row).toMatchObject({ level: 'ad', entity_id: 'old', parent_id: 'c1', spend: 20, clicks: 40, leads: 3 })
    expect(row.actions).toEqual([{ action_type: 'link_click', value: '20' }, { action_type: 'lead', value: '3' }])
  })
})

describe('runLiveRules — reads and failure handling', () => {
  const full = <T>(rows: T[]) => ({ rows, complete: true, error: null })
  function mockHealthyReads(adRows = days('2026-08-28', UNTIL).map(d => metaRow(d, 20))) {
    graph.fetchCampaignSettings.mockResolvedValue(full([{ id: 'c1', daily_budget: '5000', effective_status: 'ACTIVE' }]))
    graph.fetchAdsetSettings.mockResolvedValue(full([{ id: 'as1', campaign_id: 'c1', optimization_goal: 'LEAD_GENERATION', destination_type: 'ON_AD', effective_status: 'ACTIVE' }]))
    graph.fetchAdSettings.mockResolvedValue(full([{ id: 'old', name: 'old', adset_id: 'as1', campaign_id: 'c1', effective_status: 'ACTIVE', creative: { object_story_spec: { page_id: PAGE } } }]))
    const adsetRowsMeta: MetaAdsetDailyRow[] = adRows.map(({ ad_id: _a, ad_name: _n, ...r }) => ({ ...r, adset_id: 'as1', adset_name: 'S' }))
    graph.getAdDailyInsights.mockResolvedValue({ rows: adRows, complete: true })
    graph.getAdsetDailyInsights.mockResolvedValue({ rows: adsetRowsMeta, complete: true })
    graph.getCampaignWindowFrequency.mockResolvedValue(new Map([['c1', 1.5]]))
  }
  beforeEach(() => { vi.clearAllMocks(); mockHealthyReads() })

  it('healthy reads → a live section built from the customer\'s own page, over 28 days ending at the window end', async () => {
    const section = await runLiveRules(ARGS)
    expect(section).toMatchObject({ source: 'live', dataDate: UNTIL, adsChecked: 1, findings: [] })
    expect(graph.getAdDailyInsights).toHaveBeenCalledWith('act_1', 't', '2026-08-28', UNTIL)
    expect(graph.getAdsetDailyInsights).toHaveBeenCalledWith('act_1', 't', '2026-08-28', UNTIL)
    expect(graph.getCampaignWindowFrequency).toHaveBeenCalledWith('act_1', 't', '2026-09-18', UNTIL)
  })

  it.each([
    ['campaign settings', () => graph.fetchCampaignSettings.mockResolvedValue({ rows: [], complete: false, error: null })],
    ['ad set settings', () => graph.fetchAdsetSettings.mockResolvedValue({ rows: [], complete: false, error: null })],
    ['ad settings', () => graph.fetchAdSettings.mockResolvedValue({ rows: [], complete: false, error: null })],
    ['ad set daily rows', () => graph.getAdsetDailyInsights.mockResolvedValue({ rows: [], complete: false })],
  ])('incomplete %s → no check, live_unavailable', async (_label, breakIt) => {
    breakIt()
    expect(await runLiveRules(ARGS)).toEqual({ source: 'none', reason: 'live_unavailable' })
  })

  it('ad daily rows incomplete or over the cap → whole section dropped as too_many_ads (never truncated)', async () => {
    graph.getAdDailyInsights.mockResolvedValue({ rows: [metaRow(UNTIL, 1)], complete: false })
    expect(await runLiveRules(ARGS)).toEqual({ source: 'none', reason: 'too_many_ads' })
    graph.getAdDailyInsights.mockResolvedValue({ rows: Array.from({ length: LIVE_MAX_AD_ROWS + 1 }, () => metaRow(UNTIL, 1)), complete: true })
    expect(await runLiveRules(ARGS)).toEqual({ source: 'none', reason: 'too_many_ads' })
  })

  it('a read that throws → live_unavailable, never throws to the report', async () => {
    graph.getCampaignWindowFrequency.mockRejectedValue(new Error('boom'))
    expect(await runLiveRules(ARGS)).toEqual({ source: 'none', reason: 'live_unavailable' })
  })

  it('reads slower than the budget → live_unavailable', async () => {
    graph.fetchAdSettings.mockReturnValue(new Promise(() => undefined))
    expect(await runLiveRules(ARGS, 20)).toEqual({ source: 'none', reason: 'live_unavailable' })
  })

  it('end to end: a decaying ad read from Meta → one card; the same ad with a recent updated_time → none', async () => {
    const decaying = days('2026-08-28', UNTIL).map(d => (d < '2026-09-22' ? metaRow(d, 20, 40, 20, 3) : metaRow(d, 20, 20, 10, 1)))
    mockHealthyReads(decaying)
    const hit = await runLiveRules(ARGS)
    expect(hit.source === 'live' && hit.findings.map(f => f.kind)).toEqual(['fatigue'])

    graph.fetchAdSettings.mockResolvedValue(full([{ id: 'old', name: 'old', adset_id: 'as1', campaign_id: 'c1', effective_status: 'ACTIVE', updated_time: '2026-09-21T01:00:00+0000', creative: { object_story_spec: { page_id: PAGE } } }]))
    const changed = await runLiveRules(ARGS)
    expect(changed.source === 'live' && changed.findings).toEqual([])
  })
})
