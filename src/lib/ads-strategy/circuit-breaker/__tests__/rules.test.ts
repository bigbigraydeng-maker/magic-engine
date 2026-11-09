import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { applyBreaker } from '../apply'
import { hoursIntoLocalDay, judgeBreaker, type BreakerFacts, type SpendRow } from '../rules'
import { defaultBreakerSettings, readBreakerSettings } from '../settings'

const NOW = new Date('2026-11-09T00:00:00.000Z')

function row(over: Partial<SpendRow> = {}): SpendRow {
  return {
    accountId: 'act-demo',
    campaignId: 'camp-a',
    campaignName: '春季系列',
    day: '2026-11-09',
    spendCents: 100,
    leads: 1,
    currency: 'NZD',
    campaignLive: true,
    ...over,
  }
}

function facts(over: Partial<BreakerFacts> = {}): BreakerFacts {
  return {
    now: NOW,
    localDate: '2026-11-09',
    yesterday: '2026-11-08',
    hoursElapsed: 12,
    capCents: 1000,
    capReadable: true,
    settings: defaultBreakerSettings(),
    spend: [],
    spendReadable: true,
    policyAds: [],
    policyReadable: true,
    captures: [{ accountId: 'act-demo', capturedAt: NOW.toISOString(), complete: true }],
    insights: [{ accountId: 'act-demo', updatedAt: NOW.toISOString() }],
    accounts: ['act-demo'],
    freshReadable: true,
    ...over,
  }
}

describe('judgeBreaker', () => {
  it('实际花费高于每天上限时，只提议暂停还在投的系列', () => {
    const judged = judgeBreaker(facts({ spend: [row({ spendCents: 1500 })] }))
    expect(judged.pauses.map((item) => item.rules)).toEqual([['spend_over_cap']])
    expect(judged.pauses[0]?.campaignId).toBe('camp-a')
    expect(judged.alerts).toEqual([])
  })

  it('今天还没超，但按速度会超，也出暂停提议', () => {
    const judged = judgeBreaker(facts({
      hoursElapsed: 6,
      capCents: 1000,
      spend: [row({ spendCents: 400 })],
    }))
    expect(judged.pauses[0]?.rules).toEqual(['spend_over_cap'])
  })

  it('没超上限、也没有预测时，不出暂停', () => {
    const judged = judgeBreaker(facts({
      hoursElapsed: null,
      settings: { ...defaultBreakerSettings(), forecastEnabled: false },
      spend: [row({ spendCents: 400 })],
    }))
    expect(judged.pauses).toEqual([])
  })

  it('没有还在投的系列时，只提醒，不出卡', () => {
    const judged = judgeBreaker(facts({ spend: [row({ spendCents: 1500, campaignLive: false })] }))
    expect(judged.pauses).toEqual([])
    expect(judged.alerts.map((item) => item.code)).toEqual(['no_live_campaign'])
  })

  it('花费超过目标线索成本的两倍且没有线索时，提议暂停', () => {
    const judged = judgeBreaker(facts({
      settings: { ...defaultBreakerSettings(), targetCplCents: 100 },
      spend: [row({ spendCents: 250, leads: 0 })],
    }))
    expect(judged.pauses[0]?.rules).toEqual(['cpl_zero_leads'])
  })

  it('有线索，或没配目标成本时，不按这条提议', () => {
    const withLead = judgeBreaker(facts({
      settings: { ...defaultBreakerSettings(), targetCplCents: 100 },
      spend: [row({ spendCents: 250, leads: 1 })],
    }))
    const noTarget = judgeBreaker(facts({ spend: [row({ spendCents: 250, leads: 0 })] }))
    expect(withLead.pauses).toEqual([])
    expect(noTarget.pauses).toEqual([])
  })

  it('在投广告被判政策问题时，提议暂停它的系列', () => {
    const judged = judgeBreaker(facts({
      policyAds: [{
        accountId: 'act-demo', campaignId: 'camp-a', campaignName: '春季系列', adsetId: 'set-a',
        configuredActive: true, effectiveStatus: 'DISAPPROVED', campaignLive: true,
      }],
    }))
    expect(judged.pauses[0]).toMatchObject({ rules: ['policy_error'], adsetId: 'set-a' })
  })

  it('两个系列都有政策问题，就各出一张，不漏掉第二个', () => {
    const ad = (campaignId: string) => ({
      accountId: 'act-demo', campaignId, campaignName: campaignId, adsetId: null,
      configuredActive: true, effectiveStatus: 'WITH_ISSUES', campaignLive: true,
    })
    const judged = judgeBreaker(facts({ policyAds: [ad('camp-a'), ad('camp-b')] }))
    expect(judged.pauses.map((item) => item.campaignId).sort()).toEqual(['camp-a', 'camp-b'])
  })

  it('广告设置读不全时只提醒，不出政策暂停卡', () => {
    const judged = judgeBreaker(facts({ policyReadable: false }))
    expect(judged.pauses).toEqual([])
    expect(judged.alerts.map((item) => item.code)).toEqual(['policy_unreadable'])
  })

  it('快照超过 12 小时只提醒，不出暂停卡', () => {
    const old = new Date(NOW.getTime() - 13 * 3_600_000).toISOString()
    const judged = judgeBreaker(facts({
      captures: [{ accountId: 'act-demo', capturedAt: old, complete: true }],
      insights: [{ accountId: 'act-demo', updatedAt: old }],
    }))
    expect(judged.pauses).toEqual([])
    expect(judged.alerts.map((item) => item.code)).toEqual(['stale'])
  })

  it('开关关掉时，什么都不出', () => {
    const judged = judgeBreaker(facts({
      settings: { ...defaultBreakerSettings(), enabled: false },
      spend: [row({ spendCents: 9000, leads: 0 })],
    }))
    expect(judged).toEqual({ pauses: [], alerts: [] })
  })
})

describe('settings', () => {
  it('坏数字退回保守默认，不当成 0', () => {
    const settings = readBreakerSettings({ ads_circuit_breaker: { cpl_multiple: 1, stale_hours: 0, target_cpl_cents: 0 } }, [])
    expect(settings.cplMultiple).toBe(2)
    expect(settings.staleHours).toBe(12)
    expect(settings.targetCplCents).toBeNull()
  })

  it('客户可以把倍数调得更严，目标成本也可以写在已批准计划里', () => {
    const settings = readBreakerSettings(
      { ads_circuit_breaker: { cpl_multiple: 3, enabled: false } },
      [{ plan_data: { promo: { target_cpl_cents: 250 } } }],
    )
    expect(settings.enabled).toBe(false)
    expect(settings.cplMultiple).toBe(3)
    expect(settings.targetCplCents).toBe(250)
  })
})

describe('hoursIntoLocalDay', () => {
  it('没有时区就不预测', () => {
    expect(hoursIntoLocalDay(null, NOW)).toBeNull()
    expect(hoursIntoLocalDay('Pacific/Auckland', NOW)).toBe(13)
  })
})

describe('applyBreaker', () => {
  it('出卡并记账，但绝不写成已经暂停', async () => {
    const events: Array<{ wrote: boolean; status: string; cardRunId: string | null }> = []
    let issued = 0
    const result = await applyBreaker({
      day: '2026-11-09',
      pauses: judgeBreaker(facts({ spend: [row({ spendCents: 1500 })] })).pauses,
      alerts: [],
      deps: {
        issuePause: async () => { issued += 1; return { ok: true, runId: 'run-1' } },
        alreadyOpen: async () => false,
        record: async (event) => { events.push(event); return true },
      },
    })
    expect(result.cards).toBe(1)
    expect(issued).toBe(1)
    expect(events[0]).toMatchObject({ wrote: false, status: 'card_issued', cardRunId: 'run-1' })
  })

  it('同一天已经出过就不再出第二张', async () => {
    let issued = 0
    const result = await applyBreaker({
      day: '2026-11-09',
      pauses: judgeBreaker(facts({ spend: [row({ spendCents: 1500 })] })).pauses,
      alerts: [],
      deps: {
        issuePause: async () => { issued += 1; return { ok: true, runId: 'run-1' } },
        alreadyOpen: async () => true,
        record: async () => true,
      },
    })
    expect(issued).toBe(0)
    expect(result.skipped).toBe(1)
  })

  it('只提醒的情况不去申请暂停卡', async () => {
    let issued = 0
    const old = new Date(NOW.getTime() - 13 * 3_600_000).toISOString()
    const judged = judgeBreaker(facts({
      captures: [{ accountId: 'act-demo', capturedAt: old, complete: true }],
      insights: [{ accountId: 'act-demo', updatedAt: old }],
    }))
    const result = await applyBreaker({
      day: '2026-11-09',
      pauses: judged.pauses,
      alerts: judged.alerts,
      deps: {
        issuePause: async () => { issued += 1; return { ok: true, runId: 'run-1' } },
        alreadyOpen: async () => false,
        record: async () => true,
      },
    })
    expect(issued).toBe(0)
    expect(result.alerts).toBe(1)
  })
})

describe('no Meta write in this folder', () => {
  it('不调用广告接口，也不写熔断闸门那张表', () => {
    const dir = join(process.cwd(), 'src/lib/ads-strategy/circuit-breaker')
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.ts')) continue
      const source = readFileSync(join(dir, name), 'utf8')
      expect(source).not.toContain('graph.facebook')
      expect(source).not.toContain('setCampaignStatus')
      expect(source).not.toContain('ads_circuit_events')
    }
  })
})
