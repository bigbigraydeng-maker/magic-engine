import { describe, expect, it } from 'vitest'

import { diagnoseAudiencePoolStarved } from '../d11-audience-pool-starved'
import { runDiagnostics } from '../run'
import { buildAccountContext, shiftDate } from '../context'
import type { AccountInput, AudienceCountPoint, DailyRow, Diagnosis, DiagnosisInput, SettingChange } from '../types'
import type { EntitySnapshotRow } from '../../snapshot'

const DATE = '2026-09-25'
const PAGE = 'page-own'
const TZ = 'Pacific/Auckland'

function snap(p: Partial<EntitySnapshotRow> & Pick<EntitySnapshotRow, 'level' | 'entity_id'>): EntitySnapshotRow {
  return {
    client_id: 'c', platform: 'meta', ad_account_id: 'act_1', entity_name: p.entity_id, campaign_id: null, adset_id: null,
    status: 'ACTIVE', effective_status: 'ACTIVE', objective: null, optimization_goal: null, destination_type: null,
    budget_level: null, daily_budget_minor: null, lifetime_budget_minor: null, currency: 'NZD', bid_strategy: null,
    special_ad_categories: [], smart_promotion_type: null, included_audience_ids: [], excluded_audience_ids: [],
    advantage_audience: null, targeting_relaxation: null, targeting_summary: null, learning_stage: null, ad_studies: [],
    creative_video_ids: [], creative_page_id: null, account_status: null, disable_reason: null, timezone_name: null,
    audience_subtype: null, audience_count_lower: null, audience_rule_object_ids: [], audience_rule_events: [],
    audience_retention_days: null, audience_created_at: null, shared_account: false, settings_hash: 'h',
    capture_reason: 'daily', source_updated_time: null, captured_at: '2026-09-25T10:00:00Z',
    ...p,
  }
}

/** dates from `from` to `to` inclusive */
function days(from: string, to: string): string[] {
  const out: string[] = []
  for (let d = from; d <= to; d = shiftDate(d, 1)) out.push(d)
  return out
}

const WINDOW = days('2026-09-19', '2026-09-25')
const HISTORY_DAYS = days('2026-09-13', '2026-09-25')

const DEFAULT_HISTORY = [22300, 22200, 22300, 22200, 22300, 22200, 22200, 22300, 22200, 22300, 22200, 22300, 22200]

function audienceSnap(p: Partial<EntitySnapshotRow> = {}): EntitySnapshotRow {
  return snap({
    level: 'audience', entity_id: 'aud_video', entity_name: 'Video viewers 50% 365d',
    audience_rule_events: ['video_watched'], audience_rule_object_ids: ['v1', 'v2'],
    audience_count_lower: 22200, audience_retention_days: 365, audience_created_at: '2026-07-10T00:00:00Z',
    ...p,
  })
}

function baseSnaps(): EntitySnapshotRow[] {
  return [
    snap({ level: 'campaign', entity_id: 'c_rt' }),
    snap({ level: 'campaign', entity_id: 'c_cold' }),
    audienceSnap(),
    snap({ level: 'adset', entity_id: 'rt1', campaign_id: 'c_rt', included_audience_ids: ['aud_video', 'lal1'] }),
    snap({ level: 'ad', entity_id: 'rt_ad', campaign_id: 'c_rt', adset_id: 'rt1', creative_page_id: PAGE }),
    snap({ level: 'adset', entity_id: 'cold1', campaign_id: 'c_cold', included_audience_ids: [] }),
    snap({ level: 'ad', entity_id: 'f1', campaign_id: 'c_cold', adset_id: 'cold1', creative_page_id: PAGE, creative_video_ids: ['v1'] }),
  ]
}

function adsetRow(entityId: string, parentId: string, date: string, spend: number, impressions: number, clicks: number): DailyRow {
  return {
    level: 'adset', entity_id: entityId, parent_id: parentId, insight_date: date, spend, impressions,
    reach: null, clicks, leads: 0, messaging_conversations: 0, video_thruplays: null, actions: [],
  }
}

function adRow(entityId: string, parentId: string, date: string, spend: number): DailyRow {
  return {
    level: 'ad', entity_id: entityId, parent_id: parentId, insight_date: date, spend, impressions: 100,
    reach: null, clicks: 5, leads: 0, messaging_conversations: 0, video_thruplays: null, actions: [],
  }
}

function baseDaily(): DailyRow[] {
  return days('2026-09-09', '2026-09-25').map(d => adsetRow('rt1', 'c_rt', d, 36, 1000, 50))
}

function baseAdDaily(): DailyRow[] {
  return WINDOW.map(d => adRow('f1', 'c_cold', d, 3))
}

function historyFrom(counts: number[], ids: string[] = ['aud_video']): AudienceCountPoint[] {
  const out: AudienceCountPoint[] = []
  HISTORY_DAYS.forEach((day, i) => {
    for (const id of ids) out.push({ entity_id: id, captured_at: `${day}T00:30:00Z`, audience_count_lower: counts[i] })
  })
  return out
}

interface BuildOverrides {
  snaps?: EntitySnapshotRow[]
  daily?: DailyRow[]
  adDaily?: DailyRow[]
  history?: AudienceCountPoint[]
  settingChanges?: SettingChange[]
  clientPageId?: string | null
  dropHistory?: boolean
  dropAdDaily?: boolean
}

function makeInputs(overrides: BuildOverrides = {}): { acc: AccountInput; input: DiagnosisInput } {
  const acc: AccountInput = {
    adAccountId: 'act_1', shared: false, timezone: TZ, currency: 'NZD',
    snapshots: overrides.snaps ?? baseSnaps(),
    daily: overrides.daily ?? baseDaily(),
    hourly: {}, hourlyError: null, latestCaptures: [], lastInsightDate: DATE,
    adDaily: overrides.dropAdDaily ? undefined : (overrides.adDaily ?? baseAdDaily()),
    settingChanges: overrides.settingChanges ?? [],
    audienceHistory: overrides.dropHistory ? undefined : (overrides.history ?? historyFrom(DEFAULT_HISTORY)),
  }
  const input: DiagnosisInput = {
    clientId: 'c', date: DATE, evaluatedAt: '2026-09-26T03:00:00Z',
    outcome: { leading: 'messaging_started', primary: 'lead', targetCostPerPrimary: 11, minPrimaryPerUnit: 5 },
    outcomeConfigured: true, messagingReferralAvailable: false, digestRecipients: ['team@magicengine.com.au'],
    clientPageId: overrides.clientPageId === undefined ? PAGE : overrides.clientPageId,
    accounts: [acc],
  }
  return { acc, input }
}

function build(overrides: BuildOverrides = {}): Diagnosis[] {
  const { acc, input } = makeInputs(overrides)
  return diagnoseAudiencePoolStarved(buildAccountContext(acc, DATE), input)
}

describe('D11 · 再营销受众池断供', () => {
  it('1. hit: starved video pool with a feeder ad', () => {
    const diags = build()
    expect(diags).toHaveLength(1)
    const d = diags[0]
    expect(d.code).toBe('D11')
    expect(d.status).toBe('hit')
    expect(d.clientVisible).toBe(false)
    expect(d.evidence.audience_id).toBe('aud_video')
    expect(d.evidence.feed_spend).toBe(21)
    expect(d.evidence.consumer_spend).toBe(252)
    expect(d.evidence.feeder_ads_spending).toBe(1)
    expect(d.units).toEqual([{ level: 'adset', id: 'rt1', name: 'rt1', adAccountId: 'act_1', role: 'mixed', roleConfidence: 'low' }]) // 含类似受众的组被判 mixed，照样算消耗组（魏征 B1）
    expect(d.reasons[0]).toContain('要你点头才开')
    expect(d.reasons.some(r => r.startsWith('止损：'))).toBe(true)
    expect(d.reasons.some(r => r.includes('先补人、再判素材'))).toBe(true)
    expect(d.reasons.some(r => r.includes('池子建了') && r.includes('保留期 365 天'))).toBe(true)
    expect(d.evidence.impact).toBe('early')
    expect(d.title).toContain('还没明显影响再营销')
  })

  it('2. feeder spend 40 over the window → [] (feed share gate)', () => {
    const adDaily = WINDOW.map(d => adRow('f1', 'c_cold', d, 40 / 7))
    expect(build({ adDaily })).toEqual([])
  })

  it('3. feeder spend 25 on one day → still hit (≤10%)', () => {
    const adDaily = WINDOW.map((d, i) => adRow('f1', 'c_cold', d, i === 0 ? 25 : 0))
    const diags = build({ adDaily })
    expect(diags).toHaveLength(1)
    expect(diags[0].status).toBe('hit')
  })

  it('4. pool grew → []', () => {
    const history = historyFrom([22000, 22000, 22000, 22000, 22000, 22000, 22000, 22000, 22100, 22300, 22500, 22700, 22700]) // 窗口 9/19–25：首 3 天中位 22000 → 末 3 天 22700，涨 700 > 500
    expect(build({ history })).toEqual([])
  })

  it('5. pool shrank by 2000 → still hit', () => {
    const history = historyFrom([24200, 24200, 24200, 24200, 24200, 24200, 24200, 24200, 24200, 23500, 22800, 22200, 22200])
    const diags = build({ history })
    expect(diags).toHaveLength(1)
    expect(diags[0].status).toBe('hit')
    expect(diags[0].evidence.pool_delta).toBeLessThanOrEqual(-1500)
  })

  it('6. page-engagement pool → []', () => {
    const snaps = baseSnaps().map(s =>
      s.entity_id === 'aud_video' ? audienceSnap({ audience_rule_events: ['page_engaged'], audience_subtype: null }) : s,
    )
    expect(build({ snaps })).toEqual([])
  })

  it('7. subtype VIDEO alone qualifies → hit', () => {
    const snaps = baseSnaps().map(s =>
      s.entity_id === 'aud_video' ? audienceSnap({ audience_subtype: 'VIDEO', audience_rule_events: ['something'] }) : s,
    )
    const diags = build({ snaps })
    expect(diags).toHaveLength(1)
    expect(diags[0].status).toBe('hit')
  })

  it('8. pool at the Meta floor → []', () => {
    const snaps = baseSnaps().map(s => (s.entity_id === 'aud_video' ? audienceSnap({ audience_count_lower: 1000 }) : s))
    const history = historyFrom(new Array(HISTORY_DAYS.length).fill(1000))
    expect(build({ snaps, history })).toEqual([])
  })

  it('9. only 4 history days inside the window → []', () => {
    const history = historyFrom(DEFAULT_HISTORY).filter(p => p.captured_at >= '2026-09-22T00:00:00Z')
    expect(build({ history })).toEqual([])
  })

  it('10. pool rule changed in the window → []', () => {
    const settingChanges: SettingChange[] = [{ level: 'audience', entity_id: 'aud_video', captured_at: '2026-09-22T01:00:00Z' }]
    expect(build({ settingChanges })).toEqual([])
  })

  it('11. self-feed does not count', () => {
    const snaps = baseSnaps().concat([
      snap({ level: 'ad', entity_id: 'self_ad', campaign_id: 'c_rt', adset_id: 'rt1', creative_page_id: PAGE, creative_video_ids: ['v1'] }),
    ])
    const adDaily = baseAdDaily().concat(WINDOW.map(d => adRow('self_ad', 'c_rt', d, 100)))
    const diags = build({ snaps, adDaily })
    expect(diags).toHaveLength(1)
    expect(diags[0].status).toBe('hit')
    expect(diags[0].evidence.feed_spend).toBe(21)
  })

  it('12. consumer adset not delivering → []', () => {
    const snaps = baseSnaps().map(s => (s.entity_id === 'rt1' ? snap({ ...s, effective_status: 'PAUSED' }) : s))
    expect(build({ snaps })).toEqual([])
  })

  it('13. consumer ad on another page → []', () => {
    const snaps = baseSnaps().map(s => (s.entity_id === 'rt_ad' ? snap({ ...s, creative_page_id: 'page-other' }) : s))
    expect(build({ snaps })).toEqual([])
  })

  it('14. feeder ad on another page is not a feeder → hit with feed_spend 0', () => {
    const snaps = baseSnaps().map(s => (s.entity_id === 'f1' ? snap({ ...s, creative_page_id: 'page-other' }) : s))
    const diags = build({ snaps })
    expect(diags).toHaveLength(1)
    expect(diags[0].status).toBe('hit')
    expect(diags[0].evidence.feed_spend).toBe(0)
  })

  it('15. missing inputs → []', () => {
    expect(build({ clientPageId: null })).toEqual([])
    expect(build({ dropHistory: true })).toEqual([])
    expect(build({ dropAdDaily: true })).toEqual([])
  })

  it('16. pool older than retention / unknown age wording', () => {
    const oldSnaps = baseSnaps().map(s =>
      s.entity_id === 'aud_video' ? audienceSnap({ audience_created_at: '2025-06-01T00:00:00Z' }) : s,
    )
    const oldDiags = build({ snaps: oldSnaps })
    expect(oldDiags).toHaveLength(1)
    expect(oldDiags[0].status).toBe('hit')
    expect(oldDiags[0].reasons.some(r => r.includes('可能是进出打平'))).toBe(true)

    const unknownSnaps = baseSnaps().map(s => (s.entity_id === 'aud_video' ? audienceSnap({ audience_created_at: null }) : s))
    const unknownDiags = build({ snaps: unknownSnaps })
    expect(unknownDiags).toHaveLength(1)
    expect(unknownDiags[0].reasons.some(r => r.includes('拿不到池子建立时间或保留期'))).toBe(true)
  })

  it('17. affecting wording when CTR drops and frequency is low', () => {
    const daily = days('2026-09-09', '2026-09-25').map(d =>
      adsetRow('rt1', 'c_rt', d, 36, 1000, d >= '2026-09-23' ? 30 : 50),
    )
    const freqRow: DailyRow = {
      level: 'campaign', entity_id: 'c_rt', parent_id: null, insight_date: DATE, spend: 0, impressions: 0,
      reach: null, clicks: 0, leads: 0, messaging_conversations: 0, video_thruplays: null, actions: [], frequency_7d: 1.6,
    }
    const diags = build({ daily: daily.concat([freqRow]) })
    expect(diags).toHaveLength(1)
    expect(diags[0].title).toContain('已经开始影响再营销')
    expect(diags[0].evidence.impact).toBe('affecting')
  })

  it('18. same CTR drop but high frequency → impact early', () => {
    const daily = days('2026-09-09', '2026-09-25').map(d =>
      adsetRow('rt1', 'c_rt', d, 36, 1000, d >= '2026-09-23' ? 30 : 50),
    )
    const freqRow: DailyRow = {
      level: 'campaign', entity_id: 'c_rt', parent_id: null, insight_date: DATE, spend: 0, impressions: 0,
      reach: null, clicks: 0, leads: 0, messaging_conversations: 0, video_thruplays: null, actions: [], frequency_7d: 3.5,
    }
    const diags = build({ daily: daily.concat([freqRow]) })
    expect(diags).toHaveLength(1)
    expect(diags[0].evidence.impact).toBe('early')
  })

  it('19. two starved pools → two diagnoses sorted by audience_id', () => {
    const snaps = baseSnaps().concat([
      audienceSnap({ entity_id: 'aud_thru', entity_name: 'Thruplay viewers 365d' }),
    ])
    const rt1 = snaps.find(s => s.entity_id === 'rt1')
    expect(rt1).toBeDefined()
    const withBoth = snaps.map(s =>
      s.entity_id === 'rt1' ? snap({ ...s, included_audience_ids: ['aud_video', 'aud_thru', 'lal1'] }) : s,
    )
    const history = historyFrom(DEFAULT_HISTORY, ['aud_video', 'aud_thru'])
    const diags = build({ snaps: withBoth, history })
    expect(diags).toHaveLength(2)
    expect(diags.map(d => d.evidence.audience_id)).toEqual(['aud_thru', 'aud_video'])
  })

  it('21. consumer adset delivering but spent nothing in the window → []', () => {
    const daily = days('2026-09-09', '2026-09-25').map(d =>
      adsetRow('rt1', 'c_rt', d, d >= '2026-09-19' ? 0 : 36, 1000, 50),
    )
    expect(build({ daily, adDaily: [] })).toEqual([])
  })

  it('22. consumer adset inside a Meta experiment → []', () => {
    const study = { id: 'study1', type: 'SPLIT_TEST', start_time: '2026-09-15T00:00:00+0000', end_time: '2026-09-30T00:00:00+0000' }
    const adsetSnaps = baseSnaps().map(s => (s.entity_id === 'rt1' ? snap({ ...s, ad_studies: [study] }) : s))
    expect(build({ snaps: adsetSnaps })).toEqual([])

    const campaignSnaps = baseSnaps().map(s => (s.entity_id === 'c_rt' ? snap({ ...s, ad_studies: [study] }) : s))
    expect(build({ snaps: campaignSnaps })).toEqual([])
  })
})

describe('D11 · 编排（runDiagnostics）', () => {
  it('20. runDiagnostics surfaces exactly one D11 for a normal account', () => {
    const { input } = makeInputs()
    const run = runDiagnostics(input)
    const d11 = run.diagnoses.filter(d => d.code === 'D11')
    expect(d11).toHaveLength(1)
    expect(d11[0].status).toBe('hit')
  })

  it('21. shared account → no D11 (account-level checks only)', () => {
    const { acc, input } = makeInputs()
    const sharedInput: DiagnosisInput = { ...input, accounts: [{ ...acc, shared: true }] }
    const run = runDiagnostics(sharedInput)
    expect(run.diagnoses.filter(d => d.code === 'D11')).toEqual([])
  })
})
