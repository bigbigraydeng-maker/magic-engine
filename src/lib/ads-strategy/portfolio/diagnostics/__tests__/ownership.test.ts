/**
 * 按创意主页划归属（ownership.ts）+ 接进巡检 / 机会之后的回归。
 * 场景从 2026-09-26/27 生产只读核实派生：一个只登记给一个客户的账户里，投着别的主页的广告（各自独立广告组/系列）。
 */
import { describe, expect, it } from 'vitest'

import { flagDroppedAdsetUnits, ownershipOfAds, scopeAccountToClient } from '../ownership'
import { runDiagnostics } from '../run'
import { runOpportunities } from '../../opportunities/run'
import { shiftDate } from '../context'
import type { AccountInput, DailyRow, DiagnosisInput, HourlyRow } from '../types'
import type { EntitySnapshotRow } from '../../snapshot'

const DATE = '2026-09-24'
const EVAL = '2026-09-25T03:00:00Z'
const OWN = '1616575215312482'
const OTHER = '748077268383005'

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
const campaign = (id: string, budget: 'cbo' | 'abo' = 'abo', p: Partial<EntitySnapshotRow> = {}) =>
  snap({ level: 'campaign', entity_id: id, budget_level: budget, ...p })
const adset = (id: string, campaignId: string, p: Partial<EntitySnapshotRow> = {}) =>
  snap({ level: 'adset', entity_id: id, campaign_id: campaignId, optimization_goal: 'LEAD_GENERATION', destination_type: 'ON_AD', daily_budget_minor: 5000, ...p })
const ad = (id: string, adsetId: string, campaignId: string, page: string | null, p: Partial<EntitySnapshotRow> = {}) =>
  snap({ level: 'ad', entity_id: id, adset_id: adsetId, campaign_id: campaignId, creative_page_id: page, ...p })

function days(n: number, end = DATE): string[] { return Array.from({ length: n }, (_, i) => shiftDate(end, i - n + 1)) }
function adsetRow(id: string, campaignId: string, date: string, spend: number, leads = 0): DailyRow {
  return { level: 'adset', entity_id: id, parent_id: campaignId, insight_date: date, spend, impressions: spend * 40, reach: null, clicks: spend, leads, messaging_conversations: 0, video_thruplays: null, actions: [{ action_type: 'lead', value: String(leads) }] }
}
function campaignRow(id: string, date: string, spend: number, freq: number | null = null): DailyRow {
  return { level: 'campaign', entity_id: id, parent_id: null, insight_date: date, spend, impressions: spend * 40, reach: null, clicks: spend, leads: 0, messaging_conversations: 0, video_thruplays: null, actions: [], frequency_7d: freq }
}
function account(snapshots: EntitySnapshotRow[], daily: DailyRow[], extra: Partial<AccountInput> = {}): AccountInput {
  return { adAccountId: 'act_1', shared: false, timezone: 'Pacific/Auckland', currency: 'NZD', snapshots, daily, hourly: {}, hourlyError: null, latestCaptures: [], lastInsightDate: DATE, ...extra }
}
function input(acc: AccountInput, extra: Partial<DiagnosisInput> = {}): DiagnosisInput {
  return {
    clientId: 'c', date: DATE, evaluatedAt: '2026-09-25T03:00:00Z',
    outcome: { leading: 'lead', primary: 'lead', targetCostPerPrimary: 10, minPrimaryPerUnit: 5 },
    outcomeConfigured: true, messagingReferralAvailable: false, digestRecipients: ['team@magicengine.com.au'],
    clientPageId: OWN, accounts: [acc], ...extra,
  }
}

describe('ownershipOfAds', () => {
  it('全挂客户主页 → own；全挂别的主页 → other_page；混着 → mixed_pages', () => {
    expect(ownershipOfAds([{ creative_page_id: OWN }, { creative_page_id: OWN }], OWN)).toBe('own')
    expect(ownershipOfAds([{ creative_page_id: OTHER }], OWN)).toBe('other_page')
    expect(ownershipOfAds([{ creative_page_id: OWN }, { creative_page_id: OTHER }], OWN)).toBe('mixed_pages')
  })
  it('拿不准一律不算客户的：没有广告 / 读不到主页 → page_unknown', () => {
    expect(ownershipOfAds([], OWN)).toBe('page_unknown')
    expect(ownershipOfAds([{ creative_page_id: OWN }, { creative_page_id: null }], OWN)).toBe('page_unknown')
  })
})

/** 客户自己的 ABO 系列 c-own（两个组）+ 别家的 ABO 系列 c-other（一个组，7 天花 200、0 留资，本会命中 D3）。 */
function mixedAccount(): AccountInput {
  const snaps = [
    campaign('c-own'), adset('as-own-1', 'c-own'), adset('as-own-2', 'c-own'),
    ad('ad-own-1', 'as-own-1', 'c-own', OWN), ad('ad-own-2', 'as-own-2', 'c-own', OWN),
    campaign('c-other'), adset('as-other', 'c-other'), ad('ad-other', 'as-other', 'c-other', OTHER),
  ]
  const daily: DailyRow[] = []
  for (const d of days(7)) {
    daily.push(adsetRow('as-own-1', 'c-own', d, 10, 1), adsetRow('as-own-2', 'c-own', d, 10, 1))
    daily.push(adsetRow('as-other', 'c-other', d, 30, 0))
    daily.push(campaignRow('c-own', d, 20), campaignRow('c-other', d, 30))
  }
  const hourly: Record<string, HourlyRow[]> = {
    [DATE]: [
      { adset_id: 'as-own-1', campaign_id: 'c-own', hour: 9, spend: 5 },
      { adset_id: 'as-other', campaign_id: 'c-other', hour: 9, spend: 15 },
    ],
  }
  return account(snaps, daily, { hourly })
}

describe('scopeAccountToClient', () => {
  it('切掉别家主页的系列/广告组/广告，连同它们的日数据和小时数据；排除清单写明原因', () => {
    const scoped = scopeAccountToClient(mixedAccount(), OWN, DATE, EVAL)
    const ids = scoped.account.snapshots.map(r => r.entity_id)
    expect(ids).toEqual(expect.arrayContaining(['c-own', 'as-own-1', 'as-own-2', 'ad-own-1', 'ad-own-2']))
    expect(ids).not.toEqual(expect.arrayContaining(['c-other']))
    expect(ids.some(id => id.includes('other'))).toBe(false)
    expect(scoped.account.daily.some(r => r.entity_id.includes('other'))).toBe(false)
    expect(scoped.account.hourly[DATE]).toEqual([{ adset_id: 'as-own-1', campaign_id: 'c-own', hour: 9, spend: 5 }])
    expect(scoped.excluded).toEqual([expect.objectContaining({ level: 'adset', id: 'as-other', reason: 'other_page' })])
    expect(scoped.excluded[0].detail).toContain(OTHER)
    expect(scoped.ownWindowSpend).toBe(140)
    expect(scoped.otherPageWindowSpend).toBe(210)
  })

  it('只在小时数据里出现、快照和日数据都没有的广告组：归属判不了，小时花费不算客户的（狄仁杰）', () => {
    const acc = mixedAccount()
    acc.hourly[DATE] = [...acc.hourly[DATE], { adset_id: 'as-brand-new', campaign_id: 'c-new', hour: 10, spend: 40 }]
    const scoped = scopeAccountToClient(acc, OWN, DATE, EVAL)
    expect(scoped.account.hourly[DATE]).toEqual([{ adset_id: 'as-own-1', campaign_id: 'c-own', hour: 9, spend: 5 }])
  })

  it('快照里有、但名下还没广告也没花过钱的「空组」：快照留着，小时花费不算客户的（狄仁杰第二次复核）', () => {
    const acc = mixedAccount()
    acc.snapshots = [...acc.snapshots, adset('as-empty', 'c-own')]
    acc.hourly[DATE] = [...acc.hourly[DATE], { adset_id: 'as-empty', campaign_id: 'c-own', hour: 11, spend: 25 }]
    const scoped = scopeAccountToClient(acc, OWN, DATE, EVAL)
    expect(scoped.account.snapshots.some(r => r.entity_id === 'as-empty')).toBe(true)
    expect(scoped.account.hourly[DATE]).toEqual([{ adset_id: 'as-own-1', campaign_id: 'c-own', hour: 9, spend: 5 }])
  })

  it('幂等：切过的再切一次，账户内容不变（loader 预筛切一次、run 再切一次）', () => {
    const once = scopeAccountToClient(mixedAccount(), OWN, DATE, EVAL).account
    const twice = scopeAccountToClient(once, OWN, DATE, EVAL).account
    expect(twice.snapshots).toEqual(once.snapshots)
    expect(twice.daily).toEqual(once.daily)
    expect(twice.hourly).toEqual(once.hourly)
  })

  it('CBO 系列只要有一个子组是别家的，整个系列连同子组都不判，只列系列一条', () => {
    const snaps = [
      campaign('c-cbo', 'cbo'), adset('as-a', 'c-cbo'), adset('as-b', 'c-cbo'),
      ad('ad-a', 'as-a', 'c-cbo', OWN), ad('ad-b', 'as-b', 'c-cbo', OTHER),
    ]
    const daily = days(7).flatMap(d => [adsetRow('as-a', 'c-cbo', d, 10), adsetRow('as-b', 'c-cbo', d, 10)])
    const scoped = scopeAccountToClient(account(snaps, daily), OWN, DATE, EVAL)
    expect(scoped.account.snapshots).toEqual([])
    expect(scoped.account.daily).toEqual([])
    expect(scoped.excluded).toEqual([expect.objectContaining({ level: 'campaign', id: 'c-cbo', reason: 'mixed_pages' })])
  })

  it('ABO 系列里只切别家的那个组；系列层日数据（含 7 天去重频次）混着别人的人群，一并切掉', () => {
    const snaps = [
      campaign('c-abo'), adset('as-mine', 'c-abo'), adset('as-theirs', 'c-abo'),
      ad('ad-mine', 'as-mine', 'c-abo', OWN), ad('ad-theirs', 'as-theirs', 'c-abo', OTHER),
    ]
    const daily = [...days(7).flatMap(d => [adsetRow('as-mine', 'c-abo', d, 10), adsetRow('as-theirs', 'c-abo', d, 10)]), campaignRow('c-abo', DATE, 20, 3.4)]
    const scoped = scopeAccountToClient(account(snaps, daily), OWN, DATE, EVAL)
    expect(scoped.account.snapshots.map(r => r.entity_id)).toEqual(['c-abo', 'as-mine', 'ad-mine'])
    expect(scoped.account.daily.some(r => r.level === 'campaign')).toBe(false)
    expect(scoped.account.daily.every(r => r.entity_id === 'as-mine')).toBe(true)
  })

  it('广告在窗口里换过主页（前面挂别家）→ 整组算混的，不判（魏征反例）', () => {
    const snaps = [campaign('c1'), adset('as1', 'c1'), ad('ad1', 'as1', 'c1', OWN)]
    const acc = account(snaps, days(7).map(d => adsetRow('as1', 'c1', d, 10)), {
      adPageHistory: [
        { entity_id: 'ad1', adset_id: 'as1', creative_page_id: OTHER },
        { entity_id: 'ad1', adset_id: 'as1', creative_page_id: OWN },
      ],
    })
    const scoped = scopeAccountToClient(acc, OWN, DATE, EVAL)
    expect(scoped.account.snapshots.some(r => r.entity_id === 'as1')).toBe(false)
    expect(scoped.excluded).toEqual([expect.objectContaining({ id: 'as1', reason: 'mixed_pages' })])
  })

  it('快照里已经没有的别家广告组（被删掉的）：日数据照样切，窗口内花过钱就进排除清单（魏征生产实例）', () => {
    const snaps = [campaign('c1'), adset('as1', 'c1'), ad('ad1', 'as1', 'c1', OWN)]
    const gone = ad('ad-gone', 'as-gone', 'c-gone', OTHER, { effective_status: 'DELETED' })
    const acc = account(snaps, [adsetRow('as1', 'c1', DATE, 10), adsetRow('as-gone', 'c-gone', DATE, 13.16)], {
      recentAds: [gone],
      adDaily: [{ ...adsetRow('ad-gone', 'c-gone', DATE, 13.16), level: 'ad' }],
    })
    const scoped = scopeAccountToClient(acc, OWN, DATE, EVAL)
    expect(scoped.account.daily.map(r => r.entity_id)).toEqual(['as1'])
    expect(scoped.excluded).toEqual([expect.objectContaining({ level: 'adset', id: 'as-gone', reason: 'other_page' })])
  })

  it('有花费却读不到名下广告 → page_unknown 切掉；从没花过钱的空组不切、不列，也不连坐 CBO 系列', () => {
    const snaps = [
      campaign('c-cbo', 'cbo'), adset('as-live', 'c-cbo'), adset('as-empty', 'c-cbo', { effective_status: 'PAUSED' }),
      ad('ad-live', 'as-live', 'c-cbo', OWN),
      campaign('c2'), adset('as-noads', 'c2'),
    ]
    const daily = [adsetRow('as-live', 'c-cbo', DATE, 10), adsetRow('as-noads', 'c2', DATE, 5)]
    const scoped = scopeAccountToClient(account(snaps, daily), OWN, DATE, EVAL)
    const kept = scoped.account.snapshots.map(r => r.entity_id)
    expect(kept).toEqual(expect.arrayContaining(['c-cbo', 'as-live', 'as-empty', 'ad-live']))
    expect(kept).not.toContain('as-noads')
    expect(scoped.excluded).toEqual([expect.objectContaining({ id: 'as-noads', reason: 'page_unknown' })])
  })

  it('暂停且近 7 天没花钱的别家广告组照切，但不进排除清单（免得日报一长串）', () => {
    const snaps = [campaign('c1'), adset('as1', 'c1'), ad('ad1', 'as1', 'c1', OWN),
      campaign('c-old', 'abo', { effective_status: 'PAUSED' }), adset('as-old', 'c-old', { effective_status: 'CAMPAIGN_PAUSED' }), ad('ad-old', 'as-old', 'c-old', OTHER)]
    const scoped = scopeAccountToClient(account(snaps, [adsetRow('as1', 'c1', DATE, 10)]), OWN, DATE, EVAL)
    expect(scoped.account.snapshots.some(r => r.entity_id.includes('old'))).toBe(false)
    expect(scoped.excluded).toEqual([])
  })

  it('不切：clientPageId 没加载 / 共用账户', () => {
    const acc = mixedAccount()
    expect(scopeAccountToClient(acc, undefined, DATE, EVAL).account).toBe(acc)
    const shared = { ...acc, shared: true }
    expect(scopeAccountToClient(shared, OWN, DATE, EVAL).account).toBe(shared)
  })

  it('客户没登记主页：账户里只有一个主页 → 原样跑；≥2 个主页 → 只做账户级', () => {
    const single = account([campaign('c1'), adset('as1', 'c1'), ad('ad1', 'as1', 'c1', OTHER)], [])
    expect(scopeAccountToClient(single, null, DATE, EVAL)).toMatchObject({ accountLevelOnly: false, excluded: [] })
    const multi = scopeAccountToClient(mixedAccount(), null, DATE, EVAL)
    expect(multi.accountLevelOnly).toBe(true)
    expect(multi.excluded).toEqual([expect.objectContaining({ level: 'account', reason: 'page_unknown' })])
  })

  it('主页 id 是脏数据（全角数字、零宽字符、前导零）也要认得出，不能把客户自己的广告判成别家（Codex 2026-09-27）', () => {
    const dirtyClientPageId = '​００​1616575215312482 ' // 零宽字符 + 全角数字 + 前导零 + 尾随空格
    const snaps = [campaign('c1'), adset('as1', 'c1'), ad('ad1', 'as1', 'c1', OWN)]
    const scoped = scopeAccountToClient(account(snaps, [adsetRow('as1', 'c1', DATE, 10)]), dirtyClientPageId, DATE, EVAL)
    expect(scoped.account.snapshots.some(r => r.entity_id === 'as1')).toBe(true)
    expect(scoped.excluded).toEqual([])
  })

  it('广告层快照最近一轮没抓全或超过 24 小时 → 只做账户级（归属核实不到，Codex 2026-09-27）', () => {
    const stale = [{ level: 'ad' as const, complete: true, skipped_shared: false, error: null, captured_at: '2026-09-22T00:00:00Z' }] // 早于 evaluatedAt 3 天
    const incomplete = [{ level: 'ad' as const, complete: false, skipped_shared: false, error: 'timeout', captured_at: '2026-09-25T02:00:00Z' }] // 新鲜但没抓全
    for (const latestCaptures of [stale, incomplete]) {
      const acc = { ...mixedAccount(), latestCaptures }
      const s = scopeAccountToClient(acc, OWN, DATE, EVAL)
      expect(s.accountLevelOnly).toBe(true)
      expect(s.excluded).toEqual([expect.objectContaining({ level: 'account', reason: 'capture_stale' })])
    }
  })

  it('广告层快照最近一轮抓全且新鲜（24 小时内）→ 照常按主页切分，不降级账户级', () => {
    const fresh = [{ level: 'ad' as const, complete: true, skipped_shared: false, error: null, captured_at: '2026-09-25T02:00:00Z' }] // evaluatedAt 前 1 小时
    const acc = { ...mixedAccount(), latestCaptures: fresh }
    const scoped = scopeAccountToClient(acc, OWN, DATE, EVAL)
    expect(scoped.accountLevelOnly).toBe(false)
    expect(scoped.account.snapshots.some(r => r.entity_id === 'c-other')).toBe(false)
  })

  it('CBO 兄弟连坐 vs 广告组自己混主页：分开记，不能把「组自己没问题」标成「组本身混主页」（Codex 2026-09-27）', () => {
    const snaps = [
      campaign('c-cbo', 'cbo'),
      adset('as-clean', 'c-cbo'), ad('ad-clean', 'as-clean', 'c-cbo', OWN), // 自己 100% own，只是系列里有坏兄弟
      adset('as-bad', 'c-cbo'), ad('ad-bad', 'as-bad', 'c-cbo', OTHER), // 自己就不是客户的
    ]
    const daily = days(7).flatMap(d => [adsetRow('as-clean', 'c-cbo', d, 10), adsetRow('as-bad', 'c-cbo', d, 10)])
    const scoped = scopeAccountToClient(account(snaps, daily), OWN, DATE, EVAL)
    expect(scoped.droppedAdsetIds.has('as-clean')).toBe(true)
    expect(scoped.droppedAdsetIds.has('as-bad')).toBe(true)
    expect(scoped.selfNotOwnAdsetIds.has('as-clean')).toBe(false)
    expect(scoped.selfNotOwnAdsetIds.has('as-bad')).toBe(true)
  })

  it('广告级命中挂在纯 CBO 连坐（组自己是 own）的组上 → 不标「组混主页」；挂在组自己就混的组上才标', () => {
    const snaps = [
      campaign('c-cbo', 'cbo'),
      adset('as-clean', 'c-cbo'), ad('ad-clean', 'as-clean', 'c-cbo', OWN),
      adset('as-bad', 'c-cbo'), ad('ad-bad', 'as-bad', 'c-cbo', OTHER),
    ]
    const daily = days(7).flatMap(d => [adsetRow('as-clean', 'c-cbo', d, 10), adsetRow('as-bad', 'c-cbo', d, 10)])
    const scoped = scopeAccountToClient(account(snaps, daily), OWN, DATE, EVAL)
    const hitOn = (adsetId: string) => ({
      code: 'D10' as const, status: 'hit' as const, title: 't',
      units: [{ level: 'adset' as const, id: adsetId, name: adsetId, adAccountId: 'act_1' }],
      evidence: {}, sample: [], reasons: [], clientVisible: true,
    })
    const [cleanFlagged, badFlagged] = flagDroppedAdsetUnits([hitOn('as-clean'), hitOn('as-bad')], scoped)
    expect(cleanFlagged.evidence.adset_mixed_pages).toBeUndefined()
    expect(badFlagged.evidence.adset_mixed_pages).toBe('as-bad')
  })

  it('已归档的别家广告如果在广告层日数据里一行都没出现过（可能是写侧分页中断丢的），不能当零花费忽略——照样判混主页', () => {
    const snaps = [campaign('c1'), adset('as1', 'c1'), ad('ad1', 'as1', 'c1', OWN)]
    const gone = ad('ad-gone', 'as1', 'c1', OTHER, { effective_status: 'DELETED' })
    // adDaily 里只有 ad1 的行，ad-gone 一行都没有（既不是零花费、也不是有花费——就是没同步到）
    const acc = account(snaps, [adsetRow('as1', 'c1', DATE, 10)], {
      recentAds: [gone],
      adDaily: [{ level: 'ad', entity_id: 'ad1', parent_id: 'c1', insight_date: DATE, spend: 5, impressions: 100, reach: null, clicks: 1, leads: 0, messaging_conversations: 0, video_thruplays: null, actions: [] }],
    })
    const scoped = scopeAccountToClient(acc, OWN, DATE, EVAL)
    expect(scoped.account.snapshots.some(r => r.entity_id === 'as1')).toBe(false)
    expect(scoped.excluded).toEqual([expect.objectContaining({ id: 'as1', reason: 'mixed_pages' })])
  })

  it('对照：已归档的别家广告在广告层日数据里出现过、且每天都是零花费 → 照旧不连累这个组（行为不变）', () => {
    const snaps = [campaign('c1'), adset('as1', 'c1'), ad('ad1', 'as1', 'c1', OWN)]
    const gone = ad('ad-gone', 'as1', 'c1', OTHER, { effective_status: 'DELETED' })
    const acc = account(snaps, [adsetRow('as1', 'c1', DATE, 10)], {
      recentAds: [gone],
      adDaily: [
        { level: 'ad', entity_id: 'ad1', parent_id: 'c1', insight_date: DATE, spend: 5, impressions: 100, reach: null, clicks: 1, leads: 0, messaging_conversations: 0, video_thruplays: null, actions: [] },
        { level: 'ad', entity_id: 'ad-gone', parent_id: 'c1', insight_date: DATE, spend: 0, impressions: 0, reach: null, clicks: 0, leads: 0, messaging_conversations: 0, video_thruplays: null, actions: [] },
      ],
    })
    const scoped = scopeAccountToClient(acc, OWN, DATE, EVAL)
    expect(scoped.account.snapshots.some(r => r.entity_id === 'as1')).toBe(true)
  })
})

describe('接进巡检 / 机会之后', () => {
  it('🔴 别家广告组 7 天花 210、0 留资：不出 D3（不会进自动暂停），进排除清单', () => {
    const run = runDiagnostics(input(mixedAccount()))
    expect(run.diagnoses.filter(d => d.code === 'D3' && d.units.some(u => u.id === 'as-other'))).toEqual([])
    expect(run.excluded).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'as-other', reason: 'other_page' })]))
  })

  it('对照：同一个广告组挂的是客户主页时，D3 照样命中（证明上一条不是因为别的闸没出）', () => {
    const acc = mixedAccount()
    acc.snapshots = acc.snapshots.map(r => (r.entity_id === 'ad-other' ? { ...r, creative_page_id: OWN } : r))
    const run = runDiagnostics(input(acc))
    expect(run.diagnoses).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'D3', status: 'hit', units: [expect.objectContaining({ id: 'as-other' })] })]))
  })

  it('客户没登记主页、账户里有两个主页：不出 D3，账户进排除清单，广告级覆盖记 client_page_unknown', () => {
    const run = runDiagnostics(input({ ...mixedAccount(), adDaily: [] }, { clientPageId: null }))
    expect(run.diagnoses.some(d => d.code === 'D3')).toBe(false)
    expect(run.excluded).toEqual(expect.arrayContaining([expect.objectContaining({ level: 'account', reason: 'page_unknown' })]))
    expect(run.adLevelCoverage).toEqual([expect.objectContaining({ ran: false, reason: 'client_page_unknown' })])
  })

  it('🔴 混着别家主页的广告组被切掉，但组里挂客户主页的广告仍进广告级检查（覆盖率照常计数，魏征第二轮）', () => {
    const snaps = [
      campaign('c1'), adset('as-mixed', 'c1'),
      ad('ad-mine', 'as-mixed', 'c1', OWN), ad('ad-theirs', 'as-mixed', 'c1', OTHER),
    ]
    const run = runDiagnostics(input(account(snaps, [adsetRow('as-mixed', 'c1', DATE, 10)], { adDaily: [] })))
    expect(run.excluded).toEqual([expect.objectContaining({ id: 'as-mixed', reason: 'mixed_pages' })])
    expect(run.adLevelCoverage).toEqual([expect.objectContaining({ ran: true, reason: 'ok', adsChecked: 1 })])
  })

  it('广告级命中挂在被切掉的混主页广告组上 → 标明组层数字含别家（子牙第二轮）', () => {
    const scoped = scopeAccountToClient(account([campaign('c1'), adset('as-mixed', 'c1'), ad('a1', 'as-mixed', 'c1', OWN), ad('a2', 'as-mixed', 'c1', OTHER)],
      [adsetRow('as-mixed', 'c1', DATE, 10)]), OWN, DATE, EVAL)
    const d = { code: 'D10' as const, status: 'hit' as const, title: 't', units: [{ level: 'ad' as const, id: 'a1', name: null, adAccountId: 'act_1' }, { level: 'adset' as const, id: 'as-mixed', name: 'X', adAccountId: 'act_1' }], evidence: {}, sample: [], reasons: [], clientVisible: true }
    const [flagged] = flagDroppedAdsetUnits([d], scoped)
    expect(flagged.evidence).toMatchObject({ adset_mixed_pages: 'as-mixed' })
    expect(flagged.reasons.join('')).toContain('组层数字')
  })

  it('CBO 系列里混进一个别家组、整系列被切：客户自己的钱不能说成「全花在别家」（子牙第二轮）', () => {
    const snaps = [campaign('c-cbo', 'cbo'), adset('as-a', 'c-cbo'), adset('as-b', 'c-cbo'), ad('ad-a', 'as-a', 'c-cbo', OWN), ad('ad-b', 'as-b', 'c-cbo', OTHER)]
    const daily = days(7).flatMap(d => [adsetRow('as-a', 'c-cbo', d, 30), adsetRow('as-b', 'c-cbo', d, 2)])
    const run = runDiagnostics(input(account(snaps, daily)))
    expect(run.diagnoses.some(d => d.title.includes('登记的主页可能不对'))).toBe(false)
    expect(run.excluded).toEqual([expect.objectContaining({ level: 'campaign', id: 'c-cbo' })])
  })

  it('账户近 7 天的钱全花在别的主页上 → D7「登记主页可能不对」', () => {
    const acc = mixedAccount()
    acc.snapshots = acc.snapshots.map(r => (r.entity_id.startsWith('ad-own') ? { ...r, creative_page_id: OTHER } : r))
    const run = runDiagnostics(input(acc))
    expect(run.diagnoses).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'D7', status: 'hit', title: expect.stringContaining('登记的主页可能不对') })]))
  })

  it('广告层快照最近一轮没抓全时，不把「全被切掉」说成「登记主页不对」（原因是没抓到，魏征第二轮）', () => {
    const acc = mixedAccount()
    acc.snapshots = acc.snapshots.map(r => (r.entity_id.startsWith('ad-own') ? { ...r, creative_page_id: OTHER } : r))
    acc.latestCaptures = [{ level: 'ad', complete: false, skipped_shared: false, error: 'timeout', captured_at: '2026-09-24T09:00:00Z' }]
    const run = runDiagnostics(input(acc))
    expect(run.diagnoses.some(d => d.title.includes('登记的主页可能不对'))).toBe(false)
  })

  it('机会发现也不算别家的：别家广告组点击率再高也不出 O1', () => {
    const acc = mixedAccount()
    // 别家组点击率拉到客户组的 3 倍、花费低于均值 → 未切时会是「潜在爆款」
    acc.daily = acc.daily.map(r => (r.entity_id === 'as-other' ? { ...r, spend: 5, impressions: 2000, clicks: 150 } : r.level === 'adset' ? { ...r, impressions: 2000, clicks: 20 } : r))
    const unscoped = runOpportunities(input(acc, { clientPageId: undefined }), 'complete')
    expect(unscoped.opportunities.some(o => o.code === 'O1' && o.status === 'hit' && o.units.some(u => u.id === 'as-other'))).toBe(true)
    const scoped = runOpportunities(input(acc), 'complete')
    expect(scoped.opportunities.some(o => o.units.some(u => u.id === 'as-other'))).toBe(false)
  })
})
