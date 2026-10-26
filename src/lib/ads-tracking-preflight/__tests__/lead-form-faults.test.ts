/**
 * 表单留资三种故障。纯函数，不读网络。读不到的数不停。
 */
import { describe, expect, it } from 'vitest'
import { dailyBudgetCentsForCap, judgeLeadFormFaults, resolveCrmSurplus, type LeadFormCrm, type LeadFormJudgeInput, type LeadFormMoney, type LeadFormSync } from '../lead-form-faults'
import type { EntityFact } from '../objective-watch'

const NOW = new Date('2026-10-27T01:00:00.000Z')

function money(over: Partial<LeadFormMoney> = {}): LeadFormMoney {
  return {
    todaySpendCents: 100,
    lifetimeSpendCents: 500,
    dailyBudgetCents: 1000,
    accountCapCents: 5000,
    accountCapKnown: true,
    accountTodaySpendCents: 100,
    totalCapCents: 8000,
    totalCapKnown: true,
    clientTodaySpendCents: 100,
    multiple: null,
    currency: 'NZD',
    ...over,
  }
}

function crm(over: Partial<LeadFormCrm> = {}): LeadFormCrm {
  return { read: true, leadsToday: 2, metaLeadsToday: 2, lagHours: 2, previousSurplusSince: null, ...over }
}

function sync(over: Partial<LeadFormSync> = {}): LeadFormSync {
  return { read: true, streak: 0, failureRuns: 3, ...over }
}

const entity = (name: string, status: string): EntityFact => ({
  id: '1', name, parent_id: null, status, effective_status: status, updated_at: null,
})

const NOW_MS = NOW.getTime()

function adset(over: Partial<EntityFact> = {}): EntityFact {
  return { id: 's', name: '组', parent_id: null, status: 'ACTIVE', effective_status: 'ACTIVE', updated_at: null, daily_budget_cents: 5000, ...over }
}

function input(over: Partial<LeadFormJudgeInput> = {}): LeadFormJudgeInput {
  return {
    now: NOW,
    money: money(),
    crm: crm(),
    sync: sync(),
    ads: [entity('广告甲', 'ACTIVE')],
    adsets: [entity('广告组甲', 'ACTIVE')],
    campaignEffectiveStatus: 'ACTIVE',
    ...over,
  }
}

describe('超日上限', () => {
  it('等于上限或等于倍数不算；严格超过才算，三种原因合成一条', () => {
    expect(judgeLeadFormFaults(input({ money: money({ multiple: 2, todaySpendCents: 2000 }) })).faults).toEqual([])
    expect(judgeLeadFormFaults(input({ money: money({ accountTodaySpendCents: 5000 }) })).faults).toEqual([])
    const hit = judgeLeadFormFaults(input({
      money: money({
        multiple: 2,
        todaySpendCents: 2001,
        accountTodaySpendCents: 5001,
        clientTodaySpendCents: 8001,
      }),
    }))
    expect(hit.faults.map(item => item.code)).toEqual(['over_daily_cap'])
    expect(hit.faults[0].what).toContain('2 倍')
    expect(hit.faults[0].what).toContain('账户日上限')
    expect(hit.faults[0].what).toContain('总日上限')
  })

  it('没配、没读到，都不停，而且两种原因分开写', () => {
    const unknown = judgeLeadFormFaults(input({
      money: money({ accountCapKnown: false, totalCapKnown: false, multiple: null, dailyBudgetCents: null, todaySpendCents: null }),
    }))
    expect(unknown.faults).toEqual([])
    expect(unknown.notes.join(' ')).toContain('账户日上限没读到')
    expect(unknown.notes.join(' ')).toContain('总日上限没读到')
    expect(unknown.notes.join(' ')).toContain('没配日花费倍数')
    const unset = judgeLeadFormFaults(input({
      money: money({ accountCapCents: null, totalCapCents: null, multiple: 2, dailyBudgetCents: null }),
    }))
    expect(unset.faults).toEqual([])
    expect(unset.notes.join(' ')).toContain('账户日上限没配')
    expect(unset.notes.join(' ')).toContain('总日上限没配')
    expect(unset.notes.join(' ')).toContain('系列日预算没读到')
  })

  it('系列没有日预算时用在投广告组日预算之和；读不到不凑默认值', () => {
    const cap = (campaign: number | null, adsets: EntityFact[]) =>
      dailyBudgetCentsForCap({ campaignDailyBudgetCents: campaign, adsets, nowMs: NOW_MS })
    expect(cap(2500, [adset({ daily_budget_cents: 5000 })])).toBe(2500)
    expect(cap(null, [
      adset({ id: 'a', daily_budget_cents: 5000 }),
      adset({ id: 'b', effective_status: 'PAUSED', status: 'PAUSED', daily_budget_cents: 9000 }),
    ])).toBe(5000)
    expect(cap(0, [
      adset({ id: 'a', daily_budget_cents: 5000 }),
      adset({ id: 'b', daily_budget_cents: 3000 }),
    ])).toBe(8000)
    expect(cap(null, [
      adset({ id: 'a', daily_budget_cents: 5000 }),
      adset({ id: 'b', daily_budget_cents: null }),
    ])).toBeNull()
    expect(cap(null, [adset({ end_at: new Date(NOW_MS - 1000).toISOString(), daily_budget_cents: 5000 })])).toBeNull()
    expect(cap(null, [adset({ daily_budget_cents: null })])).toBeNull()
    const unread = judgeLeadFormFaults(input({
      money: money({ multiple: 2, dailyBudgetCents: cap(null, [adset({ daily_budget_cents: null })]), todaySpendCents: 99999 }),
    }))
    expect(unread.faults).toEqual([])
    expect(unread.notes.join(' ')).toContain('系列日预算没读到，不按倍数判')
    const accountStill = judgeLeadFormFaults(input({
      money: money({
        multiple: 2,
        dailyBudgetCents: cap(null, [adset({ daily_budget_cents: null })]),
        accountTodaySpendCents: 5001,
      }),
    }))
    expect(accountStill.faults.map(item => item.code)).toEqual(['over_daily_cap'])
    expect(accountStill.faults[0].what).toContain('账户日上限')
    expect(accountStill.faults[0].what).not.toContain('倍')
  })
})

describe('线索进不了 CRM', () => {
  it('第一小时只记时刻，满了阈值才算；对上了就把时刻清掉', () => {
    const first = judgeLeadFormFaults(input({ crm: crm({ metaLeadsToday: 3, leadsToday: 1 }) }))
    expect(first.faults).toEqual([])
    expect(first.crmSurplusSince).toBe(NOW.toISOString())
    const stale = judgeLeadFormFaults(input({
      crm: crm({
        metaLeadsToday: 3,
        leadsToday: 1,
        previousSurplusSince: new Date(NOW.getTime() - 2 * 3_600_000).toISOString(),
      }),
    }))
    expect(stale.faults.map(item => item.code)).toEqual(['crm_leads_missing'])
    expect(stale.faults[0].what).toContain('3')
    expect(stale.faults[0].what).toContain('1')
    const cleared = resolveCrmSurplus({ now: NOW, metaLeadsToday: 1, crmLeadsToday: 1, previousSince: NOW.toISOString(), lagHours: 2 })
    expect(cleared).toMatchObject({ since: null, stale: false })
  })

  it('线索数或 CRM 没读到就不停；同步连续失败够次数才停，不把原文报错写进去', () => {
    const unread = judgeLeadFormFaults(input({ crm: crm({ read: false, metaLeadsToday: null, leadsToday: null }) }))
    expect(unread.faults).toEqual([])
    expect(unread.crmSurplusSince).toBeNull()
    expect(unread.notes.join(' ')).toContain('CRM 没读到')
    const short = judgeLeadFormFaults(input({ sync: sync({ streak: 2 }) }))
    expect(short.faults).toEqual([])
    const failed = judgeLeadFormFaults(input({ sync: sync({ streak: 3 }) }))
    expect(failed.faults[0]).toMatchObject({ code: 'crm_leads_missing' })
    expect(failed.faults[0].what).toContain('连续 3 次失败')
    expect(failed.faults[0].what).not.toMatch(/token|error/i)
    const blind = judgeLeadFormFaults(input({ sync: sync({ read: false, streak: null }) }))
    expect(blind.faults).toEqual([])
    expect(blind.notes.join(' ')).toContain('同步记录没读到')
  })
})

describe('广告被拒', () => {
  it('在投的广告或广告组被拒、有问题，或系列本身这样，才算；审核中和已暂停不算', () => {
    const pending = judgeLeadFormFaults(input({ ads: [entity('广告甲', 'PENDING_REVIEW')] }))
    expect(pending.faults).toEqual([])
    const paused = judgeLeadFormFaults(input({ ads: [entity('广告甲', 'PAUSED')] }))
    expect(paused.faults).toEqual([])
    const rejected = judgeLeadFormFaults(input({
      ads: [entity('广告甲', 'DISAPPROVED')],
      adsets: [entity('广告组甲', 'WITH_ISSUES')],
      campaignEffectiveStatus: 'DISAPPROVED',
    }))
    expect(rejected.faults.map(item => item.code)).toEqual(['ad_rejected'])
    expect(rejected.faults[0].what).toContain('系列本身被拒')
    expect(rejected.faults[0].what).toContain('有问题')
    expect(rejected.faults[0].what).toContain('被拒')
  })
})
