import { describe, expect, it } from 'vitest'
import { judgeAdSetCpl, type AdSetCplInput, type AdSetSpendRow } from '../adset-cpl'

const WINDOW = ['2026-11-08', '2026-11-07', '2026-11-06'] as const

function row(over: Partial<AdSetSpendRow> = {}): AdSetSpendRow {
  return {
    accountId: 'act-demo', campaignId: 'camp-a', campaignName: '春季系列',
    adsetId: 'set-a', adsetName: '春季组', day: WINDOW[0],
    spendCents: 0, primaryCount: 0, currency: 'NZD', adsetLive: true, ...over,
  }
}

function days(parts: readonly Partial<AdSetSpendRow>[]): AdSetSpendRow[] {
  return WINDOW.map((day, index) => row({ day, ...(parts[index] ?? {}) }))
}

function input(over: Partial<AdSetCplInput> = {}): AdSetCplInput {
  return {
    nzDate: '2026-11-09', primaryResult: 'lead', targetCplCents: 100, cplMultiple: 2,
    rows: [], readable: true, ...over,
  }
}

describe('judgeAdSetCpl', () => {
  it('三个完整日花费超过目标两倍且没有线索时，判这个广告组', () => {
    const judged = judgeAdSetCpl(input({
      rows: days([{ spendCents: 80 }, { spendCents: 80 }, { spendCents: 50 }]),
    }))
    expect(judged.pauses).toHaveLength(1)
    expect(judged.pauses[0]).toMatchObject({ rule: 'cpl_zero_leads', adsetId: 'set-a' })
    expect(judged.pauses[0]?.summary).toContain('三个完整日')
    expect(judged.pauses[0]?.summary).toContain('这个广告组')
    expect(judged.unreadable).toBe(false)
  })

  it('只有一天很差、三天合计没超过两倍时不判', () => {
    const judged = judgeAdSetCpl(input({
      rows: days([
        { spendCents: 500, primaryCount: 0 },
        { spendCents: 100, primaryCount: 4 },
        { spendCents: 100, primaryCount: 4 },
      ]),
    }))
    expect(judged.pauses).toEqual([])
  })

  it('刚好等于两倍不判，超过才判；没有目标也不判', () => {
    const exact = judgeAdSetCpl(input({ rows: days([{ spendCents: 200, primaryCount: 1 }, { spendCents: 0 }, { spendCents: 0 }]) }))
    const over = judgeAdSetCpl(input({ rows: days([{ spendCents: 201, primaryCount: 1 }, { spendCents: 0 }, { spendCents: 0 }]) }))
    const twoExact = judgeAdSetCpl(input({ rows: days([{ spendCents: 200, primaryCount: 1 }, { spendCents: 200, primaryCount: 1 }, { spendCents: 0 }]) }))
    const twoOver = judgeAdSetCpl(input({ rows: days([{ spendCents: 201, primaryCount: 1 }, { spendCents: 200, primaryCount: 1 }, { spendCents: 0 }]) }))
    const zeroExact = judgeAdSetCpl(input({ rows: days([{ spendCents: 200, primaryCount: 0 }, { spendCents: 0 }, { spendCents: 0 }]) }))
    const noTarget = judgeAdSetCpl(input({ targetCplCents: null, rows: days([{ spendCents: 250, primaryCount: 0 }]) }))
    expect(exact.pauses).toEqual([])
    expect(twoExact.pauses).toEqual([])
    expect(zeroExact.pauses).toEqual([])
    expect(noTarget.pauses).toEqual([])
    expect(over.pauses[0]?.rule).toBe('cpl_over_target')
    expect(twoOver.pauses[0]?.rule).toBe('cpl_over_target')
  })

  it('已经暂停的广告组不判', () => {
    const judged = judgeAdSetCpl(input({ rows: days([{ spendCents: 250, primaryCount: 0, adsetLive: false }]) }))
    expect(judged.pauses).toEqual([])
  })

  it('开聊客户按开聊数算，留资为 0 不单独触发', () => {
    const quiet = judgeAdSetCpl(input({
      primaryResult: 'messaging_started',
      rows: days([{ spendCents: 250, primaryCount: 4 }]),
    }))
    const none = judgeAdSetCpl(input({
      primaryResult: 'messaging_started',
      rows: days([{ spendCents: 250, primaryCount: 0 }]),
    }))
    const exact = judgeAdSetCpl(input({
      primaryResult: 'messaging_started',
      rows: days([{ spendCents: 200, primaryCount: 1 }]),
    }))
    expect(quiet.pauses).toEqual([])
    expect(exact.pauses).toEqual([])
    expect(none.pauses[0]?.rule).toBe('cpl_zero_leads')
    expect(none.pauses[0]?.summary).toContain('没有开聊')
  })

  it('主结果读不出来时不判暂停，只标读不出来', () => {
    const judged = judgeAdSetCpl(input({ rows: days([{ spendCents: 250, primaryCount: null }]) }))
    expect(judged.pauses).toEqual([])
    expect(judged.unreadable).toBe(true)
  })

  it('花费读不全或窗口外的天数不算', () => {
    const hidden = judgeAdSetCpl(input({ readable: false, rows: days([{ spendCents: 250, primaryCount: 0 }]) }))
    const today = judgeAdSetCpl(input({ rows: [row({ day: '2026-11-09', spendCents: 250, primaryCount: 0 })] }))
    expect(hidden.pauses).toEqual([])
    expect(today.pauses).toEqual([])
  })
})
