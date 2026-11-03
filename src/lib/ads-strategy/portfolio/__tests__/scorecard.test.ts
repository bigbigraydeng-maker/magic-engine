/**
 * 每日广告成绩单（规则手册 v1.1 E-19 / E-20；修复方案 docs/specs/2026-11-03-ads-agent-fix-plan-v0.md 第 1 刀）。
 *
 * 考题：
 *  - 每个获客 / 再营销单位一行：花费、它自己那种结果几个、单次成本、跟目标比、样本还差几个；
 *  - 结果种类跟客户主结果不一样的组（WhatsApp 组之于留资）、不出结果的组（视频播放）单列；
 *  - 预算判断三态写出来：错配 / 没错配（写差距、门槛）/ 还差 N 个；只有一个组、没设置结果时写判不了；
 *  - 预算判断必须跟线上 D5 / O3 的结论一模一样（成绩单只是把它写出来，不另判一套）。
 */
import { describe, expect, it } from 'vitest'
import type { GraphAdsetSettings } from '@/lib/meta/entity-settings'
import { normalizeAdset, normalizeCampaign, settingsHash, type EntitySnapshotRow } from '../snapshot'
import { buildAdsScorecard, safeBuildAdsScorecard, BUDGET_GAP_THRESHOLD } from '../scorecard'
import { buildAccountContext } from '../diagnostics/context'
import { diagnoseBudgetResultMismatch } from '../diagnostics/d5-budget-result-mismatch'
import { findBudgetMismatch } from '../opportunities/o3-budget-mismatch'
import { D5_MIN_SHARE_GAP } from '../diagnostics/thresholds'
import type { AccountInput, DailyRow, DiagnosisInput } from '../diagnostics/types'

const CTX = { clientId: 'c', adAccountId: 'act_1', currency: 'NZD', sharedAccount: false }
const DATE = '2026-11-01'
const WINDOW = ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01']

function snapRow(draft: Omit<EntitySnapshotRow, 'settings_hash' | 'capture_reason' | 'captured_at'>): EntitySnapshotRow {
  return { ...draft, settings_hash: settingsHash(draft), capture_reason: 'daily', captured_at: `${DATE}T10:00:00Z` }
}

function campaign(id = 'camp_1'): EntitySnapshotRow {
  return snapRow(normalizeCampaign(CTX, { id, name: id, status: 'ACTIVE', effective_status: 'ACTIVE' }))
}

function adset(id: string, goal = 'LEAD_GENERATION', destination = 'ON_AD', campaignId = 'camp_1'): EntitySnapshotRow {
  const g: GraphAdsetSettings = {
    id, name: `组${id}`, campaign_id: campaignId, optimization_goal: goal, destination_type: destination,
    status: 'ACTIVE', effective_status: 'ACTIVE', targeting: {}, daily_budget: '5000',
  }
  return snapRow(normalizeAdset(CTX, g))
}

/** 7 天里每天一样：花 spendPerDay，出 perDay 个 actionType */
function week(adsetId: string, spendPerDay: number, perDay: number, actionType = 'lead', campaignId = 'camp_1'): DailyRow[] {
  return WINDOW.map(d => ({
    level: 'adset', entity_id: adsetId, parent_id: campaignId, insight_date: d, spend: spendPerDay,
    impressions: 1000, reach: 800, clicks: 30, leads: 0, messaging_conversations: 0, video_thruplays: null,
    actions: [{ action_type: actionType, value: String(perDay) }],
  }))
}

function input(snapshots: EntitySnapshotRow[], daily: DailyRow[], over: Partial<DiagnosisInput['outcome']> = {}, outcomeConfigured = true): DiagnosisInput {
  const account: AccountInput = {
    adAccountId: 'act_1', shared: false, timezone: 'Pacific/Auckland', currency: 'NZD',
    snapshots, daily, hourly: {}, hourlyError: null, latestCaptures: [], lastInsightDate: DATE,
  }
  return {
    clientId: 'c', date: DATE, evaluatedAt: `${DATE}T20:00:00Z`,
    outcome: { leading: null, primary: 'lead', targetCostPerPrimary: 11, minPrimaryPerUnit: 5, ...over },
    outcomeConfigured, messagingReferralAvailable: false, digestRecipients: [], accounts: [account],
  }
}

const acquisition = (s: ReturnType<typeof buildAdsScorecard>) => s.budget.find(b => b.role === 'acquisition')

describe('每个单位一行', () => {
  it('花费、它自己那种结果、单次成本、跟目标比、样本缺口', () => {
    const s = buildAdsScorecard(input([campaign(), adset('A'), adset('C')], [...week('A', 10, 2), ...week('C', 10, 1)]))
    const a = s.units.find(u => u.id === 'A')!
    expect(a).toMatchObject({ level: 'adset', role: 'acquisition', spend: 70, resultType: 'lead', results: 14, costPerResult: 5, targetCost: 11, vsTarget: 'at_or_below', sampleGap: 0, separate: null })
    const c = s.units.find(u => u.id === 'C')!
    expect(c).toMatchObject({ results: 7, costPerResult: 10, vsTarget: 'at_or_below', sampleGap: 0 })
    expect(s.window).toEqual({ start: '2026-10-26', end: '2026-11-01' })
  })

  it('单次成本高过目标 → above；结果不到最低数 → 写还差几个', () => {
    const s = buildAdsScorecard(input([campaign(), adset('A'), adset('C')], [...week('A', 20, 0), ...week('C', 10, 0)].map((r, i) => (i === 0 ? { ...r, actions: [{ action_type: 'lead', value: '3' }] } : r))))
    const a = s.units.find(u => u.id === 'A')!
    expect(a).toMatchObject({ results: 3, costPerResult: Math.round((140 / 3) * 100) / 100, vsTarget: 'above', sampleGap: 2 })
  })

  it('WhatsApp 开聊组、客户主结果是留资 → 单列「结果种类不一样」，按它自己的开聊数，不跟目标比', () => {
    const wa = adset('W', 'CONVERSATIONS', 'WHATSAPP')
    const s = buildAdsScorecard(input([campaign(), adset('A'), wa], [...week('A', 10, 2), ...week('W', 10, 3, 'onsite_conversion.messaging_conversation_started_7d')]))
    const w = s.units.find(u => u.id === 'W')!
    expect(w).toMatchObject({ resultType: 'messaging_started', results: 21, targetCost: null, vsTarget: 'no_target', separate: 'result_type_differs' })
  })

  it('视频播放组（THRUPLAY）→ 单列「不出结果」', () => {
    const s = buildAdsScorecard(input([campaign(), adset('A'), adset('V', 'THRUPLAY', 'UNDEFINED')], [...week('A', 10, 2), ...week('V', 10, 0, 'video_view')]))
    expect(s.units.find(u => u.id === 'V')).toMatchObject({ separate: 'not_result_unit' })
  })

  it('这 7 天没花钱的组不进成绩单', () => {
    const s = buildAdsScorecard(input([campaign(), adset('A'), adset('Z')], week('A', 10, 2)))
    expect(s.units.map(u => u.id)).toEqual(['A'])
  })
})

describe('预算判断三态', () => {
  it('两组差不多 → 没错配，写出最大差距和门槛（这句话以前不写）', () => {
    const s = buildAdsScorecard(input([campaign(), adset('A'), adset('C')], [...week('A', 10, 2), ...week('C', 10, 2)]))
    const b = acquisition(s)!
    expect(b).toMatchObject({ state: 'no_mismatch', under: [], over: [], threshold: BUDGET_GAP_THRESHOLD })
    expect(b.maxGap).toBeCloseTo(0, 3)
    expect(BUDGET_GAP_THRESHOLD).toBe(D5_MIN_SHARE_GAP)
  })

  it('一组同样的钱出 7 倍结果 → 错配：贵的进 under，便宜的进 over', () => {
    const s = buildAdsScorecard(input([campaign(), adset('A'), adset('C')], [...week('A', 50, 10), ...week('C', 50, 1)]))
    const b = acquisition(s)!
    expect(b.state).toBe('mismatch')
    expect(b.under).toEqual(['C'])
    expect(b.over).toEqual(['A'])
  })

  it('样本够的组不到 2 个 → 还差 N 个，列出哪个组差几个', () => {
    const daily = [...week('A', 10, 2), ...week('C', 10, 0)].map(r => (r.entity_id === 'C' && r.insight_date === DATE ? { ...r, actions: [{ action_type: 'lead', value: '2' }] } : r))
    const s = buildAdsScorecard(input([campaign(), adset('A'), adset('C')], daily))
    expect(acquisition(s)).toMatchObject({ state: 'insufficient', thin: [{ id: 'C', results: 2, need: 3 }] })
  })

  it('这类只有一个组 → 判不了（只有一个，没得比）', () => {
    const s = buildAdsScorecard(input([campaign(), adset('A')], week('A', 10, 2)))
    expect(acquisition(s)).toMatchObject({ state: 'not_comparable', reason: 'single_unit' })
  })

  it('「广告结果怎么算」没设置 → 判不了', () => {
    const s = buildAdsScorecard(input([campaign(), adset('A'), adset('C')], [...week('A', 10, 2), ...week('C', 10, 2)], { primary: null }, false))
    expect(acquisition(s)).toMatchObject({ state: 'not_comparable', reason: 'outcome_not_configured' })
  })
})

describe('预算判断跟线上 D5 / O3 一模一样（不另判一套）', () => {
  const cases: Array<[string, DailyRow[]]> = [
    ['差不多', [...week('A', 10, 2), ...week('C', 10, 2), ...week('D', 10, 2)]],
    ['一贵一便宜', [...week('A', 50, 10), ...week('C', 50, 1), ...week('D', 20, 3)]],
    ['一个样本少', [...week('A', 30, 5), ...week('C', 30, 4), ...week('D', 30, 0)]],
    // 差距超过 0.15 但样本小、不显著：D5 / O3 都不报，成绩单也不能报
    ['差距大但不显著', [...week('A', 10, 1).map((r, i) => (i === 0 ? { ...r, actions: [{ action_type: 'lead', value: '0' }] } : r)), ...week('C', 30, 1).map((r, i) => (i < 2 ? { ...r, actions: [{ action_type: 'lead', value: '0' }] } : r)), ...week('D', 20, 1)]],
    // 有一个组样本少，但它的花费占比和结果占比差不多：不算「看起来错配」
    ['样本少但不像错配', [...week('A', 10, 1), ...week('C', 10, 1), ...week('D', 1, 0).map((r, i) => (i === 0 ? { ...r, actions: [{ action_type: 'lead', value: '1' }] } : r))]],
  ]
  for (const [name, daily] of cases) {
    it(name, () => {
      const inp = input([campaign(), adset('A'), adset('C'), adset('D')], daily)
      const ctx = buildAccountContext(inp.accounts[0], inp.date)
      const d5 = diagnoseBudgetResultMismatch(ctx, inp).filter(d => d.evidence.role === 'acquisition')
      const o3 = findBudgetMismatch(ctx, inp).filter(d => d.evidence.role === 'acquisition')
      const b = acquisition(buildAdsScorecard(inp))!
      const ids = (ds: typeof d5, status: string, reason?: string) =>
        ds.filter(d => d.status === status && (reason === undefined || d.notComparableReason === reason)).flatMap(d => d.units.map(u => u.id)).sort()
      // 巡察落库时 D5 里已经被 O3 报过的单位会去掉（dropProblemsSupersededByOpportunities），under = 去重后的 D5
      const over = ids(o3, 'hit')
      expect([...b.under].sort()).toEqual(ids(d5, 'hit').filter(id => !over.includes(id)))
      expect([...b.over].sort()).toEqual(over)
      expect(b.thin.filter(t => t.suspicious).map(t => t.id).sort()).toEqual(ids(d5, 'not_comparable', 'below_min_sample'))
    })
  }
})

describe('结果归不到具体的组', () => {
  it('有一个组那几天没有原始 actions → 跟 D5 一样判不了，写明原因', () => {
    const daily = [...week('A', 10, 2), ...week('C', 10, 2).map(r => ({ ...r, actions: null }))]
    const inp = input([campaign(), adset('A'), adset('C')], daily)
    const ctx = buildAccountContext(inp.accounts[0], inp.date)
    const d5 = diagnoseBudgetResultMismatch(ctx, inp).filter(d => d.evidence.role === 'acquisition')
    expect(d5.map(d => d.notComparableReason)).toEqual(['primary_not_attributable'])
    expect(acquisition(buildAdsScorecard(inp))).toMatchObject({ state: 'not_comparable', reason: 'primary_not_attributable' })
  })
})

describe('只读、出错不挡巡察', () => {
  it('不改传进来的输入', () => {
    const inp = input([campaign(), adset('A'), adset('C')], [...week('A', 10, 2), ...week('C', 10, 1)])
    const before = JSON.stringify(inp)
    buildAdsScorecard(inp)
    expect(JSON.stringify(inp)).toBe(before)
  })

  it('算的时候出错 → 返回 { error }，不抛', () => {
    const inp = input([campaign(), adset('A')], week('A', 10, 2))
    const broken: DiagnosisInput = {
      ...inp,
      get accounts(): AccountInput[] { throw new Error('boom') },
    }
    expect(safeBuildAdsScorecard(broken)).toEqual({ error: 'boom' })
  })
})
