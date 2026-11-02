/**
 * 广告改动回看：满 7 天的暂停 / 加减预算，改前 7 天 vs 改后 7 天（见 change-review.ts）。
 * 评估日 2026-11-02，所以今天回看的是 2026-10-26（账户时区）那天的改动。
 */
import { describe, expect, it } from 'vitest'
import type { GraphAdsetSettings } from '@/lib/meta/entity-settings'
import { normalizeAdset, settingsHash, type EntitySnapshotRow } from '../snapshot'
import { localDay, reviewMaturedChanges, safeChangeReview } from '../change-review'
import { shiftDate } from '../diagnostics/context'
import type { AccountInput, DailyRow, DiagnosisInput, SettingChange } from '../diagnostics/types'

const CTX = { clientId: 'c', adAccountId: 'act_1', currency: 'NZD', sharedAccount: false }
const DATE = '2026-11-02'
const CHANGE_DAY = '2026-10-26'
// 新西兰 10-26 中午
const CHANGE_AT = '2026-10-25T23:00:00Z'

function snap(id: string, campaignId: string, optimizationGoal = 'LEAD_GENERATION'): EntitySnapshotRow {
  const g: GraphAdsetSettings = { id, name: id, campaign_id: campaignId, optimization_goal: optimizationGoal, status: 'ACTIVE', effective_status: 'ACTIVE', targeting: {} }
  const draft = normalizeAdset(CTX, g)
  return { ...draft, settings_hash: settingsHash(draft), capture_reason: 'daily', captured_at: '2026-11-02T10:00:00Z' }
}

/** 某组从 from 到 to 每天一行：每天花 spend、出 leads 条留资 */
function days(entityId: string, from: string, to: string, spend: number, leads: number): DailyRow[] {
  const out: DailyRow[] = []
  for (let d = from; d <= to; d = shiftDate(d, 1)) {
    out.push({
      level: 'adset', entity_id: entityId, parent_id: 'camp_1', insight_date: d, spend, impressions: 1000, reach: 800, clicks: 20,
      leads, messaging_conversations: 0, video_thruplays: null, actions: [{ action_type: 'lead', value: String(leads) }],
    })
  }
  return out
}

const before = (spend: number, leads: number) => days('as_1', shiftDate(CHANGE_DAY, -7), shiftDate(CHANGE_DAY, -1), spend, leads)
const after = (spend: number, leads: number) => days('as_1', shiftDate(CHANGE_DAY, 1), DATE, spend, leads)

function change(kind: SettingChange['kind'], at = CHANGE_AT, entityId = 'as_1', level: SettingChange['level'] = 'adset'): SettingChange {
  return { level, entity_id: entityId, captured_at: at, kind }
}

function input(settingChanges: SettingChange[], daily: DailyRow[], acct: Partial<AccountInput> = {}): DiagnosisInput {
  const account: AccountInput = {
    adAccountId: 'act_1', shared: false, timezone: 'Pacific/Auckland', currency: 'NZD',
    snapshots: [snap('as_1', 'camp_1'), snap('as_2', 'camp_1')], daily, hourly: {}, hourlyError: null, latestCaptures: [], lastInsightDate: DATE,
    settingChanges, ...acct,
  }
  return {
    clientId: 'c', date: DATE, evaluatedAt: '2026-11-02T20:00:00Z',
    outcome: { leading: null, primary: 'lead', targetCostPerPrimary: 20, minPrimaryPerUnit: 5 },
    outcomeConfigured: true, messagingReferralAvailable: false, digestRecipients: [], accounts: [account],
  }
}

describe('加减预算：比改前改后的单次留资成本', () => {
  it('加预算后单次成本从 20 降到 10 → 变好', () => {
    const s = reviewMaturedChanges(input([change('budget_up')], [...before(20, 1), ...after(40, 4)]))
    expect(s).toMatchObject({ reviewed: 1, decided: 1, by_verdict: { better: 1 } })
    expect(s.samples[0]).toMatchObject({ entity_id: 'as_1', kind: 'budget_up', changed_on: CHANGE_DAY, verdict: 'better', before: { spend: 140, primary: 7 }, after: { spend: 280, primary: 28 } })
  })

  it('单次成本从 10 涨到 20 → 变差', () => {
    const s = reviewMaturedChanges(input([change('budget_up')], [...before(20, 2), ...after(40, 2)]))
    expect(s.by_verdict.worse).toBe(1)
  })

  it('单次成本变化不到 20% → 持平', () => {
    const s = reviewMaturedChanges(input([change('budget_down')], [...before(20, 2), ...after(11, 1)]))
    expect(s.by_verdict.flat).toBe(1)
  })

  it('前后任一段不到 5 条留资 → 说不清（样本不够），不算有结论', () => {
    const s = reviewMaturedChanges(input([change('budget_down')], [...before(20, 1), ...after(20, 0)]))
    expect(s).toMatchObject({ reviewed: 1, decided: 0, inconclusive_reasons: { too_few_results: 1 } })
  })

  it('样本门槛读客户自己配的 minPrimaryPerUnit：配成 2 时 3 条对 3 条也能比', () => {
    const base = input([change('budget_up')], [...before(20, 0), ...after(20, 0)])
    const daily = base.accounts[0].daily.map((r, i) => (i % 7 < 3 ? { ...r, actions: [{ action_type: 'lead', value: '1' }] } : r))
    const s = reviewMaturedChanges({ ...base, outcome: { ...base.outcome, minPrimaryPerUnit: 2 }, accounts: [{ ...base.accounts[0], daily }] })
    expect(s.decided).toBe(1)
    expect(reviewMaturedChanges({ ...base, accounts: [{ ...base.accounts[0], daily }] }).inconclusive_reasons).toEqual({ too_few_results: 1 })
  })

  it('重新开启：开之前是停着的，没有改前可比 → 不回看，只计数', () => {
    const s = reviewMaturedChanges(input([change('activate')], [...before(20, 0), ...after(20, 3)]))
    expect(s).toMatchObject({ reviewed: 0, skipped_activate: 1, decided: 0 })
  })

  it('同一天上午加预算、下午改回 → 只出一条，判又改过，不算两条结论', () => {
    const back = change('budget_down', '2026-10-26T03:00:00Z')
    const s = reviewMaturedChanges(input([change('budget_up'), back], [...before(20, 1), ...after(40, 4)]))
    expect(s).toMatchObject({ reviewed: 1, decided: 0, inconclusive_reasons: { changed_again: 1 } })
  })

  it('同一天先开回来、后又停掉（列表里开启排前面）→ 也是一条又改过，不会被当成开启跳过', () => {
    const s = reviewMaturedChanges(input([change('activate', '2026-10-25T21:00:00Z'), change('pause')], before(10, 0)))
    expect(s).toMatchObject({ reviewed: 1, skipped_activate: 0, inconclusive_reasons: { changed_again: 1 } })
  })

  it('改之前 7 天里这个组也改过 → 改前那段已经被搅过，说不清', () => {
    const earlier = change('budget_down', '2026-10-21T23:00:00Z')
    const s = reviewMaturedChanges(input([earlier, change('budget_up')], [...before(20, 1), ...after(40, 4)]))
    expect(s.inconclusive_reasons).toEqual({ changed_again: 1 })
  })

  it('系列加预算、观察期里名下一个组被暂停 → 系列这条说不清', () => {
    const campaignRows = [...before(20, 1), ...after(40, 4)].map(r => ({ ...r, level: 'campaign' as const, entity_id: 'camp_1', parent_id: null }))
    const s = reviewMaturedChanges(input(
      [change('budget_up', CHANGE_AT, 'camp_1', 'campaign'), change('pause', '2026-10-28T23:00:00Z', 'as_2')],
      campaignRows,
      { snapshots: [{ ...snap('camp_1', 'camp_1'), level: 'campaign', campaign_id: null }, snap('as_1', 'camp_1'), snap('as_2', 'camp_1')] },
    ))
    expect(s.inconclusive_reasons).toEqual({ changed_again: 1 })
  })

  it('观察期里这个组又改过 → 说不清（分不清是哪次改的）', () => {
    const again = change('budget_down', '2026-10-29T23:00:00Z')
    const s = reviewMaturedChanges(input([change('budget_up'), again], [...before(20, 1), ...after(40, 4)]))
    expect(s.inconclusive_reasons).toEqual({ changed_again: 1 })
  })

  it('观察期里它所属的系列改过 → 也算又改过', () => {
    const campaign = change('budget_up', '2026-10-28T23:00:00Z', 'camp_1', 'campaign')
    const s = reviewMaturedChanges(input([change('budget_up'), campaign], [...before(20, 1), ...after(40, 4)]))
    expect(s.inconclusive_reasons).toEqual({ changed_again: 1 })
  })

  it('结果数归不上（没有原始 actions）→ 说不清（数据缺），不当成 0', () => {
    const daily = [...before(20, 1), ...after(40, 4)].map(r => ({ ...r, actions: null }))
    const s = reviewMaturedChanges(input([change('budget_up')], daily))
    expect(s.inconclusive_reasons).toEqual({ data_missing: 1 })
  })
})

describe('暂停：看改之前那 7 天该不该停', () => {
  it('停之前 7 天花了 70、零留资（≥ 目标 20 × 2）→ 止损成立', () => {
    const s = reviewMaturedChanges(input([change('pause')], before(10, 0)))
    expect(s).toMatchObject({ decided: 1, by_verdict: { stop_loss_justified: 1 } })
  })

  it('停之前单次成本 10、比目标 20 还便宜 → 停掉了达标的组', () => {
    const s = reviewMaturedChanges(input([change('pause')], before(10, 1)))
    expect(s.by_verdict.paused_a_performer).toBe(1)
  })

  it('停之前只有 1 条留资（单次 14 也比目标便宜）→ 样本不够，不算停掉了达标的组', () => {
    const daily = before(2, 0).map((r, i) => (i === 0 ? { ...r, actions: [{ action_type: 'lead', value: '1' }] } : r))
    const s = reviewMaturedChanges(input([change('pause')], daily))
    expect(s.inconclusive_reasons).toEqual({ too_few_results: 1 })
  })

  it('按开聊优化的组、客户主结果是留资：零留资不算止损成立（结果种类对不上）', () => {
    const s = reviewMaturedChanges(input([change('pause')], before(30, 0), { snapshots: [snap('as_1', 'camp_1', 'CONVERSATIONS')] }))
    expect(s).toMatchObject({ decided: 0, inconclusive_reasons: { goal_mismatch: 1 } })
  })

  it('按开聊优化的 WhatsApp 组加预算：前后按开聊比，不拿留资去数', () => {
    const msg = (spend: number, n: number, from: string, to: string) =>
      days('as_1', from, to, spend, 0).map(r => ({ ...r, actions: [{ action_type: 'onsite_conversion.messaging_conversation_started_7d', value: String(n) }] }))
    const daily = [...msg(20, 1, shiftDate(CHANGE_DAY, -7), shiftDate(CHANGE_DAY, -1)), ...msg(40, 4, shiftDate(CHANGE_DAY, 1), DATE)]
    const wa = { ...snap('as_1', 'camp_1', 'CONVERSATIONS'), destination_type: 'WHATSAPP' }
    const s = reviewMaturedChanges(input([change('budget_up')], daily, { snapshots: [wa] }))
    expect(s.by_verdict.better).toBe(1)
    expect(s.samples[0].before.primary).toBe(7)
  })

  it('做曝光的组（按触达优化）花了钱没留资 → 不按结果判，不算止损成立', () => {
    const s = reviewMaturedChanges(input([change('pause')], before(30, 0), { snapshots: [snap('as_1', 'camp_1', 'REACH')] }))
    expect(s).toMatchObject({ decided: 0, inconclusive_reasons: { not_result_unit: 1 } })
  })

  it('系列下各组优化目标不一样 → 结果归不准，说不清（不拿系列快照的空格去数）', () => {
    const campaignRows = before(10, 0).map(r => ({ ...r, level: 'campaign' as const, entity_id: 'camp_1', parent_id: null }))
    const snapshots = [{ ...snap('camp_1', 'camp_1'), level: 'campaign' as const, campaign_id: null }, snap('as_1', 'camp_1'), snap('as_2', 'camp_1', 'OFFSITE_CONVERSIONS')]
    const s = reviewMaturedChanges(input([change('pause', CHANGE_AT, 'camp_1', 'campaign')], campaignRows, { snapshots }))
    expect(s.inconclusive_reasons).toEqual({ data_missing: 1 })
  })

  it('系列下各组优化目标一样 → 系列暂停照常判', () => {
    const campaignRows = before(10, 0).map(r => ({ ...r, level: 'campaign' as const, entity_id: 'camp_1', parent_id: null }))
    const snapshots = [{ ...snap('camp_1', 'camp_1'), level: 'campaign' as const, campaign_id: null }, snap('as_1', 'camp_1'), snap('as_2', 'camp_1')]
    const s = reviewMaturedChanges(input([change('pause', CHANGE_AT, 'camp_1', 'campaign')], campaignRows, { snapshots }))
    expect(s.by_verdict.stop_loss_justified).toBe(1)
  })

  it('停之前就没花钱（清理用）→ 不回看，只计数', () => {
    const s = reviewMaturedChanges(input([change('pause')], []))
    expect(s).toMatchObject({ reviewed: 0, skipped_no_spend: 1, decided: 0 })
  })

  it('停之前有结果、但单次成本 35 高于目标 20 → 说不清（停得有道理，算不上止损）', () => {
    const s = reviewMaturedChanges(input([change('pause')], before(10, 0).map((r, i) => (i < 2 ? { ...r, actions: [{ action_type: 'lead', value: '1' }] } : r))))
    expect(s.inconclusive_reasons).toEqual({ cost_above_target: 1 })
  })

  it('花得少、也没结果（不到目标两倍）→ 说不清', () => {
    const s = reviewMaturedChanges(input([change('pause')], before(3, 0)))
    expect(s.inconclusive_reasons).toEqual({ too_few_results: 1 })
  })

  it('目标单次成本没设置 → 说不清（没有目标成本）', () => {
    const base = input([change('pause')], before(10, 0))
    const s = reviewMaturedChanges({ ...base, outcome: { ...base.outcome, targetCostPerPrimary: null } })
    expect(s.inconclusive_reasons).toEqual({ no_target_cost: 1 })
  })
})

describe('哪些改动拿来回看', () => {
  it('只看正好满 7 天的（账户时区那一天）：6 天和 8 天前的都不看', () => {
    const six = change('budget_up', '2026-10-26T23:00:00Z')
    const eight = change('budget_up', '2026-10-24T23:00:00Z')
    expect(reviewMaturedChanges(input([six, eight], [...before(20, 1), ...after(40, 4)])).reviewed).toBe(0)
  })

  it('按账户时区切天：UTC 10-25 23:00 在新西兰已经是 10-26', () => {
    expect(localDay('2026-10-25T23:00:00Z', 'Pacific/Auckland')).toBe('2026-10-26')
    expect(localDay('2026-10-25T23:00:00Z', null)).toBe('2026-10-25')
  })

  it('只改了别的字段 / 老数据没有 kind → 不看', () => {
    const s = reviewMaturedChanges(input([change('other'), change(undefined)], before(10, 0)))
    expect(s.reviewed).toBe(0)
  })

  it('不在客户快照里的组（别人的、或已删）→ 不看', () => {
    const s = reviewMaturedChanges(input([change('pause', CHANGE_AT, 'as_other')], before(10, 0)))
    expect(s.reviewed).toBe(0)
  })

  it('共用账户 → 整个不看（分不清是谁的改动）', () => {
    const s = reviewMaturedChanges(input([change('pause')], before(10, 0), { shared: true }))
    expect(s.reviewed).toBe(0)
  })

  it('「广告结果怎么算」没设置 → 说不清（没设置结果）', () => {
    const base = input([change('budget_up')], [...before(20, 1), ...after(40, 4)])
    const s = reviewMaturedChanges({ ...base, outcome: { ...base.outcome, primary: null } })
    expect(s.inconclusive_reasons).toEqual({ no_outcome_config: 1 })
  })

  it('同一天同一处记了两次暂停（重复抓取）→ 只算一条，照常判', () => {
    const s = reviewMaturedChanges(input([change('pause'), change('pause', '2026-10-26T01:00:00Z')], before(10, 0)))
    expect(s).toMatchObject({ reviewed: 1, by_verdict: { stop_loss_justified: 1 } })
  })
})

describe('只读、出错不挡正式流程', () => {
  it('不改传进来的输入', () => {
    const inp = input([change('budget_up')], [...before(20, 1), ...after(40, 4)])
    const frozen = JSON.stringify(inp)
    reviewMaturedChanges(inp)
    expect(JSON.stringify(inp)).toBe(frozen)
  })

  it('改动时间是坏值（时区换算会抛错）→ 返回 { error }，不抛', () => {
    expect(safeChangeReview(input([change('pause', 'not-a-date')], before(10, 0)))).toHaveProperty('error')
  })
})
