/**
 * 表单留资当天花费和线索。假的 Graph，不碰真网络。
 */
import { describe, expect, it } from 'vitest'
import { parseInsightTotals, readTodaySpend, type TodaySpendRead } from '../lead-form-read'
import type { GraphGet } from '../meta-reader'

const NOW = new Date('2026-10-26T20:00:00.000Z')

function graphOf(handler: (path: string, params: Record<string, string>) => unknown): { get: GraphGet; calls: { path: string; params: Record<string, string> }[] } {
  const calls: { path: string; params: Record<string, string> }[] = []
  const get: GraphGet = async (path, params) => {
    calls.push({ path, params })
    return handler(path, params)
  }
  return { get, calls }
}

describe('parseInsightTotals', () => {
  it('没有 data 数组是没读到；空数组是 0；线索只取一种，不把父子动作加在一起', () => {
    expect(parseInsightTotals({ weird: true })).toBeNull()
    expect(parseInsightTotals({ data: [] })).toEqual({ spendCents: 0, leads: 0 })
    const both = parseInsightTotals({
      data: [{ spend: '1.25', actions: [{ action_type: 'lead', value: '2' }, { action_type: 'onsite_conversion.lead_grouped', value: '9' }] }],
    })
    expect(both).toEqual({ spendCents: 125, leads: 2 })
    expect(parseInsightTotals({ data: [{ spend: 'nope' }] })).toBeNull()
  })
})

describe('readTodaySpend', () => {
  it('没有时区就不读；系列和账户的 level 分开；任一登记账户没读到，客户总花费就是没读到', async () => {
    const skipped = await readTodaySpend({
      graphGet: async () => { throw new Error('should not run') },
      adAccountId: 'act_444444444444',
      campaignId: '333333333333',
      registeredAccountIds: ['444444444444'],
      now: NOW,
      timezone: null,
    })
    expect(skipped).toEqual({ campaignSpendCents: null, campaignLeads: null, accountSpendCents: null, clientSpendCents: null })

    const { get, calls } = graphOf((path) => {
      if (path === 'act_555555555555/insights') return null
      return { data: [{ spend: '2.00', actions: [{ action_type: 'lead', value: '1' }] }] }
    })
    const out = await readTodaySpend({
      graphGet: get,
      adAccountId: 'act_444444444444',
      campaignId: '333333333333',
      registeredAccountIds: ['act_444444444444', 'act_555555555555'],
      now: NOW,
      timezone: 'Pacific/Auckland',
    })
    expect(calls.map(call => [call.path, call.params.level])).toEqual([
      ['333333333333/insights', 'campaign'],
      ['act_444444444444/insights', 'account'],
      ['act_555555555555/insights', 'account'],
    ])
    expect(calls[0].params.time_range).toContain('2026-10-27')
    const expected: TodaySpendRead = {
      campaignSpendCents: 200,
      campaignLeads: 1,
      accountSpendCents: 200,
      clientSpendCents: null,
    }
    expect(out).toEqual(expected)
  })

  it('登记账户一个都没有 → 客户总花费没读到，不把单个系列当成全部', async () => {
    const { get } = graphOf(() => ({ data: [{ spend: '1.00', actions: [] }] }))
    const out = await readTodaySpend({
      graphGet: get,
      adAccountId: 'act_444444444444',
      campaignId: '333333333333',
      registeredAccountIds: [],
      now: NOW,
      timezone: 'Pacific/Auckland',
    })
    expect(out.clientSpendCents).toBeNull()
    expect(out.campaignSpendCents).toBe(100)
    expect(out.campaignLeads).toBe(0)
  })
})
