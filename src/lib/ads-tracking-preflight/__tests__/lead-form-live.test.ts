/**
 * 表单留资额外读数里的纯函数：上限怎么认、同步连续失败、当天从几点算、上一小时的盈余时刻。
 */
import { describe, expect, it } from 'vitest'
import { previousSurplusSince, summaryMentionsCampaign } from '../lead-form-history'
import { accountCapFromRows, startOfZonedDay, syncFailureStreak, totalCapFromSource } from '../lead-form-live'

describe('上限', () => {
  it('查询失败和没配是两回事；总上限不接受默认空配置', () => {
    expect(accountCapFromRows(null, 'act_444444444444')).toEqual({ known: false, cents: null })
    expect(accountCapFromRows([], 'act_444444444444')).toEqual({ known: true, cents: null })
    expect(accountCapFromRows([{ ad_account_id: '444444444444', daily_budget_cap_cents: 1500 }], 'act_444444444444')).toEqual({ known: true, cents: 1500 })
    expect(totalCapFromSource('fallback', null)).toEqual({ known: false, cents: null })
    expect(totalCapFromSource('default', null)).toEqual({ known: false, cents: null })
    expect(totalCapFromSource('row', null)).toEqual({ known: true, cents: null })
    expect(totalCapFromSource('row', 8000)).toEqual({ known: true, cents: 8000 })
  })
})

describe('同步连续失败', () => {
  const run = (clientId: string, error?: string, skipped?: string) => ({
    summary: { results: [{ clientId, clientName: null, error, skipped }] },
  })

  it('失败和被挡住都算；中间有一轮成功或这个客户没出现，连续就断', () => {
    const runs = [run('c1', 'HTTP 500'), run('c1', undefined, 'page_not_verified'), run('c1', 'HTTP 500'), run('c1')]
    expect(syncFailureStreak(runs, 'c1')).toBe(3)
    expect(syncFailureStreak([run('c1'), run('c1', 'HTTP 500')], 'c1')).toBe(0)
    expect(syncFailureStreak([{ summary: { results: [] } }, run('c1', 'HTTP 500')], 'c1')).toBe(0)
    expect(syncFailureStreak([run('other', 'HTTP 500')], 'c1')).toBe(0)
  })
})

describe('账户时区的今天', () => {
  it('新西兰夏令时当天 0 点是前一天 11 点 UTC；不认识的时区不算', () => {
    expect(startOfZonedDay(new Date('2026-10-26T20:00:00.000Z'), 'Pacific/Auckland')).toBe('2026-10-26T11:00:00.000Z')
    expect(startOfZonedDay(new Date('2026-10-26T20:00:00.000Z'), 'Not/AZone')).toBeNull()
  })
})

describe('上一小时盈余', () => {
  const summary = {
    clients: [{
      client_id: 'c1',
      objective_watch: { series: [{ campaign_id: '333333333333', crm_surplus_since: '2026-10-27T00:00:00.000Z' }] },
    }],
  }

  it('只认这个客户这个系列的时刻；对上了就停，不往更早翻', () => {
    expect(previousSurplusSince(summary, 'c1', '333333333333')).toBe('2026-10-27T00:00:00.000Z')
    expect(previousSurplusSince(summary, 'c2', '333333333333')).toBeNull()
    expect(previousSurplusSince({ clients: [] }, 'c1', '333333333333')).toBeNull()
    const cleared = { clients: [{ client_id: 'c1', objective_watch: { series: [{ campaign_id: '333333333333', crm_surplus_since: null }] } }] }
    expect(previousSurplusSince(cleared, 'c1', '333333333333')).toBeNull()
    expect(summaryMentionsCampaign(cleared, 'c1', '333333333333')).toBe(true)
    expect(summaryMentionsCampaign(null, 'c1', '333333333333')).toBe(false)
  })
})
