import { describe, expect, it } from 'vitest'

import { diagnoseAdLevelRules } from '../d2-d10-ad-rules'
import { buildAccountContext, shiftDate } from '../context'
import { runDiagnostics } from '../run'
import type { AccountInput, DailyRow, Diagnosis, DiagnosisInput, SettingChange } from '../types'
import type { EntitySnapshotRow } from '../../snapshot'

const DATE = '2026-09-24'
const PAGE = 'page-own'

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
    capture_reason: 'daily', source_updated_time: null, captured_at: '2026-09-24T10:00:00Z',
    ...p,
  }
}
const campaign = (id = 'c1') => snap({ level: 'campaign', entity_id: id, budget_level: 'cbo' })
const adset = (p: Partial<EntitySnapshotRow> = {}) => snap({ level: 'adset', entity_id: 'as1', campaign_id: 'c1', optimization_goal: 'LEAD_GENERATION', destination_type: 'ON_AD', ...p })
const ad = (id: string, p: Partial<EntitySnapshotRow> = {}) => snap({ level: 'ad', entity_id: id, campaign_id: 'c1', adset_id: 'as1', creative_page_id: PAGE, ...p })

interface DaySpec { spend: number; impressions: number; clicks: number; linkClicks: number; leads: number }
/** ad-level row. 🔴 parent_id is the CAMPAIGN id on purpose (that is what production stores for ad rows). */
function adRow(id: string, date: string, d: DaySpec, actionsNull = false): DailyRow {
  return {
    level: 'ad', entity_id: id, parent_id: 'c1', insight_date: date, spend: d.spend, impressions: d.impressions,
    reach: Math.round(d.impressions * 0.8), clicks: d.clicks, leads: d.leads, messaging_conversations: 0, video_thruplays: null,
    actions: actionsNull ? null : [{ action_type: 'link_click', value: String(d.linkClicks) }, { action_type: 'lead', value: String(d.leads) }],
  }
}
/** dates from `from` to `to` inclusive */
function days(from: string, to: string): string[] { const out: string[] = []; for (let d = from; d <= to; d = shiftDate(d, 1)) out.push(d); return out }
/** adset-level rows = sum of the given ad rows per day (needed by the spend-share gate) */
function adsetRowsFrom(adRows: DailyRow[], adsetId = 'as1'): DailyRow[] {
  const byDay = new Map<string, { spend: number; impressions: number; clicks: number; leads: number }>()
  for (const row of adRows) {
    const cur = byDay.get(row.insight_date) ?? { spend: 0, impressions: 0, clicks: 0, leads: 0 }
    cur.spend += row.spend
    cur.impressions += row.impressions
    cur.clicks += row.clicks
    cur.leads += row.leads
    byDay.set(row.insight_date, cur)
  }
  const out: DailyRow[] = []
  for (const [date, agg] of byDay) {
    out.push({
      level: 'adset', entity_id: adsetId, parent_id: 'c1', insight_date: date, spend: agg.spend, impressions: agg.impressions,
      reach: null, clicks: agg.clicks, leads: agg.leads, messaging_conversations: 0, video_thruplays: null, actions: [],
    })
  }
  return out
}
function campaignFreqRow(freq: number, date = DATE): DailyRow {
  return {
    level: 'campaign', entity_id: 'c1', parent_id: null, insight_date: date, spend: 0, impressions: 0, reach: null,
    clicks: 0, leads: 0, messaging_conversations: 0, video_thruplays: null, actions: [], frequency_7d: freq,
  }
}

function account(snaps: EntitySnapshotRow[], adDaily: DailyRow[], extraDaily: DailyRow[] = [], settingChanges: SettingChange[] = []): AccountInput {
  return { adAccountId: 'act_1', shared: false, timezone: 'Pacific/Auckland', currency: 'NZD', snapshots: snaps,
    daily: [...adsetRowsFrom(adDaily), ...extraDaily], hourly: {}, hourlyError: null, latestCaptures: [], lastInsightDate: DATE,
    adDaily, settingChanges }
}
function input(extra: Partial<DiagnosisInput> = {}): DiagnosisInput {
  return { clientId: 'c', date: DATE, evaluatedAt: '2026-09-25T03:00:00Z',
    outcome: { leading: 'messaging_started', primary: 'lead', targetCostPerPrimary: 11, minPrimaryPerUnit: 5 },
    outcomeConfigured: true, messagingReferralAvailable: false, digestRecipients: ['team@magicengine.com.au'],
    clientPageId: PAGE, accounts: [], ...extra }
}
const run = (acc: AccountInput, extra: Partial<DiagnosisInput> = {}): Diagnosis[] => diagnoseAdLevelRules(buildAccountContext(acc, DATE), input(extra))

// ---------------------------------------------------------------------------
// Scenario A — new test ad eating budget with a broken form
// ---------------------------------------------------------------------------

const PEER_DAYS = days('2026-09-08', '2026-09-24')
const V4_DAYS = days('2026-09-22', '2026-09-24')

function scenarioASnaps(): EntitySnapshotRow[] {
  return [campaign(), adset(), ad('p1'), ad('p2'), ad('v4')]
}

function scenarioAAdDaily(v4: DaySpec[]): DailyRow[] {
  const rows: DailyRow[] = []
  for (const d of PEER_DAYS) {
    rows.push(adRow('p1', d, { spend: 20, impressions: 600, clicks: 40, linkClicks: 20, leads: 3 }))
    rows.push(adRow('p2', d, { spend: 14, impressions: 420, clicks: 28, linkClicks: 14, leads: 2 }))
  }
  V4_DAYS.forEach((d, i) => rows.push(adRow('v4', d, v4[i])))
  return rows
}

const V4_BROKEN: DaySpec[] = [
  { spend: 66.53, impressions: 2406, clicks: 86, linkClicks: 41, leads: 0 },
  { spend: 45.23, impressions: 2208, clicks: 60, linkClicks: 40, leads: 1 },
  { spend: 55.72, impressions: 2656, clicks: 82, linkClicks: 47, leads: 4 },
]

function findFor(diags: Diagnosis[], code: string, id: string): Diagnosis | undefined {
  return diags.find(d => d.code === code && d.units.some(u => u.id === id))
}

describe('Scenario A — new test ad with a broken form (D10)', () => {
  it('1. D10 hit on v4 with peer baseline, checkBack and止损 reason', () => {
    const diags = run(account(scenarioASnaps(), scenarioAAdDaily(V4_BROKEN)))
    const d10 = diags.filter(d => d.code === 'D10' && d.status === 'hit')
    expect(d10).toHaveLength(1)
    const hit = d10[0]
    // 广告单位带所属广告组的角色（内部日报按角色归栏）
    expect(hit.units[0]).toEqual({ level: 'ad', id: 'v4', name: 'v4', adAccountId: 'act_1', role: 'acquisition', roleConfidence: 'high' })
    expect(hit.units[1].id).toBe('as1')
    expect(hit.evidence.baseline_source).toBe('same_adset_peers')
    expect(hit.evidence.peer_ads).toBe(2)
    expect(hit.title).toContain('比同组其他广告')
    expect(hit.checkBack).toBeDefined()
    expect(hit.checkBack?.fallback).toContain('停掉这条（新上线或刚重新开投的）')
    expect(hit.reasons[0]).toContain('测试版应该单独放一个组测')
    expect(hit.reasons[1].startsWith('止损：')).toBe(true)
    expect(hit.reasons.some(r => r.includes('p='))).toBe(false)
    expect(hit.checkBack?.after.startsWith('3 天后')).toBe(true)
    expect(Number(hit.evidence.lifetime_cost_multiple) >= 1.5).toBe(true)
    expect(hit.clientVisible).toBe(false)
  })

  it('2. no D2 for v4 (fatigue never compares with siblings)', () => {
    const diags = run(account(scenarioASnaps(), scenarioAAdDaily(V4_BROKEN)))
    expect(findFor(diags, 'D2', 'v4')).toBeUndefined()
  })

  it('3. page gate: v4 on another page produces nothing about v4', () => {
    const snaps = [campaign(), adset(), ad('p1'), ad('p2'), ad('v4', { creative_page_id: 'page-other' })]
    const diags = run(account(snaps, scenarioAAdDaily(V4_BROKEN)))
    expect(diags.some(d => d.units.some(u => u.id === 'v4'))).toBe(false)
  })

  it('4. clientPageId null → single client_page_unknown note with settings href', () => {
    const diags = run(account(scenarioASnaps(), scenarioAAdDaily(V4_BROKEN)), { clientPageId: null })
    expect(diags).toHaveLength(1)
    expect(diags[0].code).toBe('D10')
    expect(diags[0].status).toBe('not_comparable')
    expect(diags[0].notComparableReason).toBe('client_page_unknown')
    expect(diags[0].manualTask?.href).toBe('https://app.magicengine.com.au/dashboard/clients/c/settings')
  })

  it('5. clientPageId undefined → []', () => {
    const diags = run(account(scenarioASnaps(), scenarioAAdDaily(V4_BROKEN)), { clientPageId: undefined })
    expect(diags).toEqual([])
  })

  it('6. adDaily undefined → []', () => {
    const acc = account(scenarioASnaps(), scenarioAAdDaily(V4_BROKEN))
    const noAdDaily: AccountInput = { ...acc, adDaily: undefined }
    const diags = run(noAdDaily)
    expect(diags).toEqual([])
  })

  it('7. cost gate: cheap broken-form ad produces no D10 hit', () => {
    const cheap: DaySpec[] = [
      { spend: 10, impressions: 2406, clicks: 86, linkClicks: 41, leads: 2 },
      { spend: 10, impressions: 2208, clicks: 60, linkClicks: 40, leads: 3 },
      { spend: 10, impressions: 2656, clicks: 82, linkClicks: 47, leads: 3 },
    ]
    const diags = run(account(scenarioASnaps(), scenarioAAdDaily(cheap)))
    expect(findFor(diags, 'D10', 'v4')?.status).not.toBe('hit')
  })

  it('8. persistence gate: only one bad day → no D10 hit', () => {
    const oneBad: DaySpec[] = [
      { spend: 50, impressions: 2400, clicks: 80, linkClicks: 80, leads: 0 },
      { spend: 50, impressions: 2400, clicks: 80, linkClicks: 40, leads: 6 },
      { spend: 50, impressions: 2400, clicks: 80, linkClicks: 40, leads: 6 },
    ]
    const diags = run(account(scenarioASnaps(), scenarioAAdDaily(oneBad)))
    expect(findFor(diags, 'D10', 'v4')?.status).not.toBe('hit')
  })

  it('9. not delivering → nothing about v4; video goal → []', () => {
    const paused = [campaign(), adset(), ad('p1'), ad('p2'), ad('v4', { effective_status: 'PAUSED' })]
    const pausedDiags = run(account(paused, scenarioAAdDaily(V4_BROKEN)))
    expect(pausedDiags.some(d => d.units.some(u => u.id === 'v4'))).toBe(false)

    const videoSnaps = [campaign(), adset({ optimization_goal: 'THRUPLAY' }), ad('p1'), ad('p2'), ad('v4')]
    const videoDiags = run(account(videoSnaps, scenarioAAdDaily(V4_BROKEN)))
    expect(videoDiags).toEqual([])
  })

  it('10. starved ad (spend share < 10%) produces nothing about it', () => {
    const snaps = [campaign(), adset(), ad('p1'), ad('p2'), ad('v4'), ad('tiny')]
    const rows = scenarioAAdDaily(V4_BROKEN)
    for (const d of V4_DAYS) rows.push(adRow('tiny', d, { spend: 0.5, impressions: 300, clicks: 3, linkClicks: 2, leads: 0 }))
    const diags = run(account(snaps, rows))
    expect(diags.some(d => d.units.some(u => u.id === 'tiny'))).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Scenario B — an old ad whose CTR decays (D2)
// ---------------------------------------------------------------------------

const OLD_DAYS = days('2026-08-28', '2026-09-24')
const OLD_GOOD = days('2026-08-28', '2026-09-21')
const OLD_BAD = days('2026-09-22', '2026-09-24')

function scenarioBAdDaily(): DailyRow[] {
  const rows: DailyRow[] = []
  for (const d of OLD_GOOD) rows.push(adRow('old', d, { spend: 20, impressions: 1000, clicks: 40, linkClicks: 20, leads: 3 }))
  for (const d of OLD_BAD) rows.push(adRow('old', d, { spend: 20, impressions: 1000, clicks: 20, linkClicks: 10, leads: 1 }))
  return rows
}

function scenarioBSnaps(): EntitySnapshotRow[] {
  return [campaign(), adset(), ad('old')]
}

describe('Scenario B — old ad CTR decay (D2)', () => {
  it('11. D2 hit with creative fatigue kind and checkBack', () => {
    const diags = run(account(scenarioBSnaps(), scenarioBAdDaily(), [campaignFreqRow(1.7)]))
    const d2 = diags.filter(d => d.code === 'D2' && d.status === 'hit')
    expect(d2).toHaveLength(1)
    const hit = d2[0]
    expect(hit.units[0].id).toBe('old')
    expect(hit.evidence.baseline_source).toBe('own_history')
    expect(hit.evidence.fatigue_kind).toBe('creative')
    expect(hit.title).toContain('素材老化')
    expect(hit.checkBack?.fallback).toContain('停掉新建的那个测试组，这条不动')
    expect(hit.reasons[0]).toContain('另建一个新广告组')
    expect(hit.reasons.some(r => r.includes('新增一条广告'))).toBe(false)
  })

  it('12. high frequency → audience fatigue kind', () => {
    const diags = run(account(scenarioBSnaps(), scenarioBAdDaily(), [campaignFreqRow(3.5)]))
    const d2 = diags.filter(d => d.code === 'D2' && d.status === 'hit')
    expect(d2).toHaveLength(1)
    expect(d2[0].evidence.fatigue_kind).toBe('audience')
    expect(d2[0].title).toContain('看腻')
    expect(d2[0].checkBack?.fallback).toBe('改回原来的受众')
  })

  it('13. no campaign row → unknown fatigue kind', () => {
    const diags = run(account(scenarioBSnaps(), scenarioBAdDaily()))
    const d2 = diags.filter(d => d.code === 'D2' && d.status === 'hit')
    expect(d2).toHaveLength(1)
    expect(d2[0].evidence.fatigue_kind).toBe('unknown')
    expect(d2[0].title).toContain('频次拿不到')
    expect(d2[0].reasons[0].startsWith('频次拿不到')).toBe(true)
    expect(d2[0].checkBack?.condition).not.toContain('新组')
    expect(d2[0].checkBack?.fallback).toContain('按当时的频次')
  })

  it('14a. change on 2026-09-20 → no D2 hit, recently_changed note titled with the date', () => {
    const changes: SettingChange[] = [{ level: 'adset', entity_id: 'as1', captured_at: '2026-09-20T02:00:00Z' }]
    const diags = run(account(scenarioBSnaps(), scenarioBAdDaily(), [campaignFreqRow(1.7)], changes))
    expect(diags.filter(d => d.code === 'D2' && d.status === 'hit')).toHaveLength(0)
    const note = diags.find(d => d.status === 'not_comparable' && d.notComparableReason === 'recently_changed')
    expect(note).toBeDefined()
    expect(note?.title).toContain('2026-09-20')
  })

  it('14b. change on 2026-09-08 → D2 hit still present (baseline keeps 2026-09-15..21)', () => {
    const changes: SettingChange[] = [{ level: 'adset', entity_id: 'as1', captured_at: '2026-09-08T02:00:00Z' }]
    const diags = run(account(scenarioBSnaps(), scenarioBAdDaily(), [campaignFreqRow(1.7)], changes))
    expect(diags.filter(d => d.code === 'D2' && d.status === 'hit')).toHaveLength(1)
  })

  it('14c. change on 2026-09-15 → neither a D2 hit nor a recently_changed note', () => {
    const changes: SettingChange[] = [{ level: 'adset', entity_id: 'as1', captured_at: '2026-09-15T02:00:00Z' }]
    const diags = run(account(scenarioBSnaps(), scenarioBAdDaily(), [campaignFreqRow(1.7)], changes))
    expect(diags.filter(d => d.code === 'D2' && d.status === 'hit')).toHaveLength(0)
    expect(diags.some(d => d.status === 'not_comparable' && d.notComparableReason === 'recently_changed')).toBe(false)
  })

  it('15. change older than the baseline window → D2 hit still present', () => {
    const changes: SettingChange[] = [{ level: 'adset', entity_id: 'as1', captured_at: '2026-09-01T08:00:00Z' }]
    const diags = run(account(scenarioBSnaps(), scenarioBAdDaily(), [campaignFreqRow(1.7)], changes))
    expect(diags.filter(d => d.code === 'D2' && d.status === 'hit')).toHaveLength(1)
  })

  it('16. ad set stopped one day inside the window → recently_changed note, no D2 hit', () => {
    const rows = scenarioBAdDaily().filter(r => !(r.entity_id === 'old' && r.insight_date === '2026-09-20'))
    const otherAdsetRow: DailyRow = {
      level: 'adset', entity_id: 'as-other', parent_id: 'c1', insight_date: '2026-09-20', spend: 30, impressions: 100,
      reach: null, clicks: 5, leads: 0, messaging_conversations: 0, video_thruplays: null, actions: [],
    }
    const diags = run(account(scenarioBSnaps(), rows, [campaignFreqRow(1.7), otherAdsetRow]))
    expect(diags.filter(d => d.code === 'D2' && d.status === 'hit')).toHaveLength(0)
    const note = diags.find(d => d.status === 'not_comparable' && d.notComparableReason === 'recently_changed')
    expect(note).toBeDefined()

    const gapRows = scenarioBAdDaily().filter(r => !(r.entity_id === 'old' && r.insight_date === '2026-09-12'))
    const gapOtherRow: DailyRow = {
      level: 'adset', entity_id: 'as-other', parent_id: 'c1', insight_date: '2026-09-12', spend: 30, impressions: 100,
      reach: null, clicks: 5, leads: 0, messaging_conversations: 0, video_thruplays: null, actions: [],
    }
    const gapDiags = run(account(scenarioBSnaps(), gapRows, [campaignFreqRow(1.7), gapOtherRow]))
    expect(gapDiags.filter(d => d.code === 'D2' && d.status === 'hit')).toHaveLength(0)
    expect(gapDiags.some(d => d.status === 'not_comparable' && d.notComparableReason === 'recently_changed')).toBe(false)
  })

  it('17. 蜜月期剔除：新广告头 7 天的高点击率不进对照（剔除后降幅不够，不报）', () => {
    const snaps = [campaign(), adset(), ad('young'), ad('anchor', { creative_page_id: 'page-other' })]
    const rows: DailyRow[] = []
    rows.push(adRow('anchor', '2026-08-28', { spend: 1, impressions: 10, clicks: 1, linkClicks: 1, leads: 0 }))
    for (const d of days('2026-09-10', '2026-09-16')) rows.push(adRow('young', d, { spend: 20, impressions: 1000, clicks: 80, linkClicks: 40, leads: 6 }))
    for (const d of days('2026-09-17', '2026-09-21')) rows.push(adRow('young', d, { spend: 20, impressions: 1000, clicks: 40, linkClicks: 20, leads: 3 }))
    for (const d of days('2026-09-22', '2026-09-24')) rows.push(adRow('young', d, { spend: 20, impressions: 1000, clicks: 35, linkClicks: 17, leads: 2 }))
    const diags = run(account(snaps, rows, [campaignFreqRow(1.7)]))
    expect(findFor(diags, 'D2', 'young')).toBeUndefined()
  })

})

// ---------------------------------------------------------------------------
// 每道闸单独直测（配合变异测试）
// ---------------------------------------------------------------------------

describe('每道闸单独直测（配合变异测试）', () => {
  it('p 值闸：降幅、期望数、持续性、成本都过，但校正后不显著 → 不命中', () => {
    const snaps = [campaign(), adset(), ad('p1'), ad('p2'), ad('weak')]
    const rows = scenarioAAdDaily(V4_BROKEN).filter(r => r.entity_id !== 'v4')
    const weak: DaySpec[] = [
      { spend: 12, impressions: 800, clicks: 30, linkClicks: 12, leads: 1 },
      { spend: 12, impressions: 800, clicks: 30, linkClicks: 12, leads: 1 },
      { spend: 12, impressions: 800, clicks: 30, linkClicks: 11, leads: 1 },
    ]
    V4_DAYS.forEach((d, i) => rows.push(adRow('weak', d, weak[i])))
    const diags = run(account(snaps, rows))
    const hit = diags.find(d => d.code === 'D10' && d.status === 'hit' && d.units[0]?.id === 'weak')
    expect(hit).toBeUndefined()
  })

  it('成本下限闸：近 3 天花的钱还不够对照里拿一个结果 → 不判', () => {
    const snaps = [campaign(), adset(), ad('q1'), ad('q1b'), ad('q2')]
    const rows: DailyRow[] = []
    for (const d of PEER_DAYS) {
      rows.push(adRow('q1', d, { spend: 15, impressions: 500, clicks: 20, linkClicks: 10, leads: 1 }))
      rows.push(adRow('q1b', d, { spend: 15, impressions: 500, clicks: 20, linkClicks: 10, leads: 1 }))
    }
    for (const d of V4_DAYS) rows.push(adRow('q2', d, { spend: 4, impressions: 900, clicks: 60, linkClicks: 30, leads: 0 }))
    const diags = run(account(snaps, rows))
    expect(diags.some(d => d.units[0]?.id === 'q2')).toBe(false)
  })

  it('花费占比闸：占所在广告组不到 10% → 不判', () => {
    const snaps = [campaign(), adset(), ad('p1'), ad('p2'), ad('v4'), ad('tiny2')]
    const rows = scenarioAAdDaily(V4_BROKEN)
    for (const d of V4_DAYS) rows.push(adRow('tiny2', d, { spend: 8, impressions: 300, clicks: 30, linkClicks: 20, leads: 0 }))
    const diags = run(account(snaps, rows))
    expect(diags.some(d => d.units[0]?.id === 'tiny2')).toBe(false)
    expect(findFor(diags, 'D10', 'v4')?.status).toBe('hit')
  })

  it('同组对照只认快照里的广告组，不按日数据 parent_id（它是系列 id）', () => {
    const snaps = [campaign(), adset(), ad('p1'), ad('p2'), ad('v4'), adset({ entity_id: 'as2' }), ad('x1', { adset_id: 'as2' })]
    const rows = scenarioAAdDaily(V4_BROKEN)
    for (const d of PEER_DAYS) rows.push(adRow('x1', d, { spend: 5, impressions: 3000, clicks: 300, linkClicks: 200, leads: 0 }))
    const diags = run(account(snaps, rows))
    const hit = findFor(diags, 'D10', 'v4')
    expect(hit?.status).toBe('hit')
    expect(hit?.evidence.peer_ads).toBe(2)
  })

  it('actions 为空且有点击的那天整天剔除', () => {
    const rows = scenarioAAdDaily(V4_BROKEN).map(r =>
      r.entity_id === 'v4' && r.insight_date === '2026-09-23'
        ? adRow('v4', '2026-09-23', { spend: 45.23, impressions: 2208, clicks: 60, linkClicks: 40, leads: 1 }, true)
        : r,
    )
    const diags = run(account(scenarioASnaps(), rows))
    const hit = findFor(diags, 'D10', 'v4')
    expect(hit?.status).toBe('hit')
    expect(hit?.evidence.dropped_days).toBe(1)
    expect(hit?.evidence.recent_link_clicks).toBe(88)
  })

  it('D2 自身基线天数不足 5 天 → 不判（即使掉得很厉害）：9/11 上线，剔除头 7 天后对照期只剩 9/18–9/21 四天', () => {
    const snaps = [campaign(), adset(), ad('young2'), ad('anchor', { creative_page_id: 'page-other' })]
    const rows: DailyRow[] = []
    rows.push(adRow('anchor', '2026-08-28', { spend: 1, impressions: 10, clicks: 1, linkClicks: 1, leads: 0 }))
    for (const d of days('2026-09-11', '2026-09-21')) rows.push(adRow('young2', d, { spend: 20, impressions: 1000, clicks: 80, linkClicks: 40, leads: 6 }))
    for (const d of days('2026-09-22', '2026-09-24')) rows.push(adRow('young2', d, { spend: 20, impressions: 1000, clicks: 30, linkClicks: 15, leads: 2 }))
    const diags = run(account(snaps, rows, [campaignFreqRow(1.7)]))
    expect(findFor(diags, 'D2', 'young2')).toBeUndefined()
  })

  it('曝光→结果闸：点击率高一倍、点击→留资低一截但每次曝光换来的留资差不多 → 不命中（真实案例：组里花费第一的广告）', () => {
    const snaps = [campaign(), adset(), ad('p1'), ad('p2'), ad('winner')]
    const rows = scenarioAAdDaily(V4_BROKEN).filter(r => r.entity_id !== 'v4')
    for (const d of V4_DAYS) rows.push(adRow('winner', d, { spend: 70, impressions: 1000, clicks: 130, linkClicks: 70, leads: 6 }))
    const diags = run(account(snaps, rows))
    expect(findFor(diags, 'D10', 'winner')?.status).not.toBe('hit')

    const brokenRows = scenarioAAdDaily(V4_BROKEN).filter(r => r.entity_id !== 'v4')
    for (const d of V4_DAYS) brokenRows.push(adRow('winner', d, { spend: 70, impressions: 1000, clicks: 130, linkClicks: 70, leads: 2 }))
    const brokenDiags = run(account(snaps, brokenRows))
    expect(findFor(brokenDiags, 'D10', 'winner')?.status).toBe('hit')
  })

  it('同组对照只在这条花得比同组其他广告合计少时才成立：组里的主力不拿被饿着的小广告当对照', () => {
    const snaps = [campaign(), adset(), ad('small1'), ad('small2'), ad('main')]
    const rows: DailyRow[] = []
    for (const d of PEER_DAYS) {
      rows.push(adRow('small1', d, { spend: 5, impressions: 150, clicks: 6, linkClicks: 3, leads: 1 }))
      rows.push(adRow('small2', d, { spend: 5, impressions: 150, clicks: 6, linkClicks: 3, leads: 1 }))
    }
    for (const d of days('2026-09-15', '2026-09-24')) rows.push(adRow('main', d, { spend: 25, impressions: 1200, clicks: 50, linkClicks: 20, leads: 1 }))
    const diags = run(account(snaps, rows))
    expect(findFor(diags, 'D10', 'main')?.status).not.toBe('hit')

    const liveRows: DailyRow[] = []
    for (const d of PEER_DAYS) {
      liveRows.push(adRow('small1', d, { spend: 5, impressions: 150, clicks: 6, linkClicks: 3, leads: 1 }))
      liveRows.push(adRow('small2', d, { spend: 5, impressions: 150, clicks: 6, linkClicks: 3, leads: 1 }))
    }
    for (const d of V4_DAYS) liveRows.push(adRow('main', d, { spend: 25, impressions: 1200, clicks: 50, linkClicks: 20, leads: 0 }))
    const liveDiags = run(account(snaps, liveRows))
    expect(findFor(liveDiags, 'D10', 'main')?.status).toBe('hit')
  })

  it('D2 点击率地板：自身正常点击率 < 0.5% 不算信号', () => {
    const snaps = [campaign(), adset(), ad('lowctr')]
    const rows: DailyRow[] = []
    for (const d of days('2026-08-28', '2026-09-21')) rows.push(adRow('lowctr', d, { spend: 20, impressions: 5000, clicks: 20, linkClicks: 10, leads: 1 }))
    for (const d of days('2026-09-22', '2026-09-24')) rows.push(adRow('lowctr', d, { spend: 20, impressions: 5000, clicks: 8, linkClicks: 4, leads: 0 }))
    const diags = run(account(snaps, rows, [campaignFreqRow(1.7)]))
    expect(findFor(diags, 'D2', 'lowctr')).toBeUndefined()
  })

  it('同组对照不挂「最近改过」闸：组里 9/16 改过设置，新广告照样能判', () => {
    const changes: SettingChange[] = [
      { level: 'adset', entity_id: 'as1', captured_at: '2026-09-16T02:00:00Z' },
      { level: 'campaign', entity_id: 'c1', captured_at: '2026-09-21T02:00:00Z' },
    ]
    const diags = run(account(scenarioASnaps(), scenarioAAdDaily(V4_BROKEN), [], changes))
    expect(findFor(diags, 'D10', 'v4')?.status).toBe('hit')
  })

  it('样本不够：贵了但链接点击太少 → 只出「还不够判」备注', () => {
    const thin: DaySpec[] = [
      { spend: 20, impressions: 800, clicks: 30, linkClicks: 5, leads: 0 },
      { spend: 20, impressions: 800, clicks: 30, linkClicks: 5, leads: 0 },
      { spend: 20, impressions: 800, clicks: 30, linkClicks: 5, leads: 0 },
    ]
    const diags = run(account(scenarioASnaps(), scenarioAAdDaily(thin)))
    const note = diags.find(d => d.units.some(u => u.id === 'v4') && d.status === 'not_comparable')
    expect(note).toBeDefined()
    expect(note?.notComparableReason).toBe('below_min_sample')
    expect(note?.title).toContain('还不够判')
    expect(findFor(diags, 'D10', 'v4')?.status).not.toBe('hit')
  })

  it('上线至今成本闸：只是最近 3 天差、上线以来整体仍便宜 → 不报', () => {
    const snaps = [campaign(), adset(), ad('p1'), ad('p2'), ad('steady')]
    const rows = scenarioAAdDaily(V4_BROKEN).filter(r => r.entity_id !== 'v4')
    for (const d of days('2026-09-15', '2026-09-21')) rows.push(adRow('steady', d, { spend: 10, impressions: 500, clicks: 25, linkClicks: 20, leads: 6 }))
    for (const d of V4_DAYS) rows.push(adRow('steady', d, { spend: 40, impressions: 1500, clicks: 60, linkClicks: 40, leads: 1 }))
    const diags = run(account(snaps, rows))
    expect(findFor(diags, 'D10', 'steady')?.status).not.toBe('hit')

    const liveRows = scenarioAAdDaily(V4_BROKEN).filter(r => r.entity_id !== 'v4')
    for (const d of days('2026-09-15', '2026-09-21')) liveRows.push(adRow('steady', d, { spend: 10, impressions: 500, clicks: 25, linkClicks: 20, leads: 0 }))
    for (const d of V4_DAYS) liveRows.push(adRow('steady', d, { spend: 40, impressions: 1500, clicks: 60, linkClicks: 40, leads: 1 }))
    const liveDiags = run(account(snaps, liveRows))
    expect(findFor(liveDiags, 'D10', 'steady')?.status).toBe('hit')
  })

  it('成本倍数闸（走自身历史、没有上线至今闸兜底）：点击→留资掉了但每个留资反而更便宜 → 不报', () => {
    const snaps = [campaign(), adset(), ad('o2')]
    const rows: DailyRow[] = []
    for (const d of days('2026-08-28', '2026-09-21')) rows.push(adRow('o2', d, { spend: 20, impressions: 1000, clicks: 40, linkClicks: 20, leads: 3 }))
    for (const d of days('2026-09-22', '2026-09-24')) rows.push(adRow('o2', d, { spend: 5, impressions: 1000, clicks: 40, linkClicks: 20, leads: 1 }))
    const diags = run(account(snaps, rows, [campaignFreqRow(1.7)]))
    expect(findFor(diags, 'D10', 'o2')?.status).not.toBe('hit')

    const liveRows: DailyRow[] = []
    for (const d of days('2026-08-28', '2026-09-21')) liveRows.push(adRow('o2', d, { spend: 20, impressions: 1000, clicks: 40, linkClicks: 20, leads: 3 }))
    for (const d of days('2026-09-22', '2026-09-24')) liveRows.push(adRow('o2', d, { spend: 12, impressions: 1000, clicks: 40, linkClicks: 20, leads: 1 }))
    const liveDiags = run(account(snaps, liveRows, [campaignFreqRow(1.7)]))
    const hit = findFor(liveDiags, 'D10', 'o2')
    expect(hit?.status).toBe('hit')
    expect(hit?.evidence.baseline_source).toBe('own_history')
  })

  it('评估日之后的改动不算（回放/补跑安全）', () => {
    const changes: SettingChange[] = [{ level: 'adset', entity_id: 'as1', captured_at: '2026-09-26T02:00:00Z' }]
    const diags = run(account(scenarioBSnaps(), scenarioBAdDaily(), [campaignFreqRow(1.7)], changes))
    expect(diags.filter(d => d.code === 'D2' && d.status === 'hit')).toHaveLength(1)
    expect(diags.some(d => d.status === 'not_comparable' && d.notComparableReason === 'recently_changed')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// runDiagnostics wiring
// ---------------------------------------------------------------------------

describe('runDiagnostics wiring', () => {
  it('19. non-shared account yields the D10 hit; shared account yields no D10/D2', () => {
    const acc = account(scenarioASnaps(), scenarioAAdDaily(V4_BROKEN))
    const wired = runDiagnostics({ ...input(), accounts: [acc] })
    expect(wired.diagnoses.some(d => d.code === 'D10' && d.status === 'hit' && d.units.some(u => u.id === 'v4'))).toBe(true)

    const sharedAcc: AccountInput = { ...acc, shared: true }
    const sharedWired = runDiagnostics({ ...input(), accounts: [sharedAcc] })
    expect(sharedWired.diagnoses.some(d => d.code === 'D10' || d.code === 'D2')).toBe(false)
  })

  it('20. two accounts both with clientPageId null and recent spend → exactly one client_page_unknown', () => {
    const accA = account(scenarioASnaps(), scenarioAAdDaily(V4_BROKEN))
    const accB = account(scenarioASnaps(), scenarioAAdDaily(V4_BROKEN))
    const wired = runDiagnostics({ ...input({ clientPageId: null }), accounts: [accA, accB] })
    const notes = wired.diagnoses.filter(d => d.notComparableReason === 'client_page_unknown')
    expect(notes).toHaveLength(1)
  })
})
