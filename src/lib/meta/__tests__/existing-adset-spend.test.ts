import { describe, expect, it } from 'vitest'
import { sameInheritedSpend } from '@/lib/ads-strategy/ad-draft'
import { inheritedSpendFrom } from '../existing-adset-spend'

const START = '2026-10-01T00:00:00+0000'
const END = '2026-10-08T00:00:00+0000'

describe('inheritedSpendFrom', () => {
  it('reads daily cents and an open end', () => {
    const parsed = inheritedSpendFrom({ daily_budget: '10000', start_time: START }, null)
    expect(parsed).toEqual({ ok: true, spend: { dailyBudget: 100, durationDays: null, endTime: null } })
  })

  it('counts whole days from start to end and keeps that end time', () => {
    const parsed = inheritedSpendFrom({ daily_budget: '1500', start_time: START, end_time: END }, null)
    expect(parsed).toEqual({ ok: true, spend: { dailyBudget: 15, durationDays: 7, endTime: END } })
  })

  it('keeps the absolute end time when the same span is shifted', () => {
    const end = '2026-11-01T00:00:00+0000'
    const parsed = inheritedSpendFrom({
      daily_budget: '1500',
      start_time: '2026-10-01T00:00:00+0000',
      end_time: end,
    }, null)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.spend.endTime).toBe(end)
    expect(parsed.spend.endTime).not.toBe(new Date(end).toISOString())
    const shifted = inheritedSpendFrom({
      daily_budget: '1500',
      start_time: '2026-10-15T00:00:00+0000',
      end_time: '2026-11-15T00:00:00+0000',
    }, null)
    expect(shifted.ok).toBe(true)
    if (!shifted.ok) return
    expect(shifted.spend.durationDays).toBe(parsed.spend.durationDays)
    expect(shifted.spend.endTime).toBe('2026-11-15T00:00:00+0000')
    expect(sameInheritedSpend(parsed.spend, shifted.spend)).toBe(false)
    expect(sameInheritedSpend(parsed.spend, { ...parsed.spend })).toBe(true)
    expect(sameInheritedSpend(
      { dailyBudget: 15, durationDays: 31 },
      parsed.spend,
    )).toBe(false)
    expect(sameInheritedSpend(
      { dailyBudget: 100, durationDays: null },
      { dailyBudget: 100, durationDays: null, endTime: null },
    )).toBe(true)
  })

  it('does not treat a lifetime budget as a daily amount', () => {
    const parsed = inheritedSpendFrom({ lifetime_budget: '5000', start_time: START }, null)
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.error).toContain('总预算')
  })

  it('uses the campaign daily budget when the ad set has none', () => {
    const missing = inheritedSpendFrom({ start_time: START }, null)
    expect(missing).toEqual({ ok: false, error: 'NEED_CAMPAIGN' })
    const parsed = inheritedSpendFrom({ start_time: START }, { daily_budget: '10000' })
    expect(parsed).toEqual({ ok: true, spend: { dailyBudget: 100, durationDays: null, endTime: null } })
  })

  it('rejects an end that cannot be read', () => {
    const parsed = inheritedSpendFrom({ daily_budget: '1000', start_time: START, end_time: 'soon' }, null)
    expect(parsed.ok).toBe(false)
  })
})
