import { describe, it, expect } from 'vitest'
import { headroomText } from '../scorecard-section'
import type { BudgetHeadroom } from '@/lib/ads-strategy/heartbeat/budget-headroom'

function h(over: Partial<BudgetHeadroom>): BudgetHeadroom {
  return { state: 'ok', totalDaily: 200, currency: 'NZD', unreadableCount: 0, unreadableAccounts: 0, cap: 300, headroom: 100, level: 'ample', ...over }
}

describe('headroomText', () => {
  it('留有余地：中性，写出合计、上限、还剩多少和快照时间', () => {
    const t = headroomText(h({}), '2026-11-05T06:31:00Z')
    expect(t.tone).toBe('neutral')
    expect(t.lines[0]).toBe('在投每天预算合计 NZD 200.00 · 客户每天总上限 NZD 300.00 · 还剩 NZD 100.00')
    expect(t.lines[t.lines.length - 1]).toContain('读取时间')
  })

  it('顶到上限：黄色，明说再加预算会被拦', () => {
    const t = headroomText(h({ cap: 200.01, headroom: 0.01, level: 'full' }), null)
    expect(t.tone).toBe('amber')
    expect(t.lines.join('|')).toContain('再加预算会被系统拦下')
  })

  it('已超过上限：红色', () => {
    expect(headroomText(h({ cap: 150, headroom: -50, level: 'over' }), null).tone).toBe('red')
  })

  it('没设总上限：不编上限，直说没设', () => {
    const t = headroomText(h({ cap: null, headroom: null, level: 'no_cap' }), null)
    expect(t.lines[0]).toContain('在广告计划里填上每天的广告总上限')
  })

  it('有读不到预算的在投组：写出个数，说明没算进合计', () => {
    const t = headroomText(h({ unreadableCount: 2 }), null)
    expect(t.lines.join('|')).toContain('另有 2 个在投的组读不到日预算')
  })

  it('有账户没读到：说明合计只会更多、不会更少', () => {
    const t = headroomText(h({ unreadableAccounts: 1 }), null)
    expect(t.lines.join('|')).toContain('有 1 个广告账户这次没读到，合计只会更多、不会更少')
  })

  it('币种不一致：不下结论', () => {
    const t = headroomText(h({ state: 'unavailable' }), null)
    expect(t.lines[0]).toContain('算不了')
  })
})
