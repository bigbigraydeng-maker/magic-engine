import { describe, expect, it } from 'vitest'
import { inheritedSpendFrom } from '../existing-adset-spend'

const START = '2026-10-01T00:00:00+0000'
const END = '2026-10-08T00:00:00+0000'

describe('inheritedSpendFrom', () => {
  it('reads daily cents and an open end', () => {
    const parsed = inheritedSpendFrom({ daily_budget: '10000', start_time: START }, null)
    expect(parsed).toEqual({ ok: true, spend: { dailyBudget: 100, durationDays: null } })
  })

  it('counts whole days from start to end', () => {
    const parsed = inheritedSpendFrom({ daily_budget: '1500', start_time: START, end_time: END }, null)
    expect(parsed).toEqual({ ok: true, spend: { dailyBudget: 15, durationDays: 7 } })
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
    expect(parsed).toEqual({ ok: true, spend: { dailyBudget: 100, durationDays: null } })
  })

  it('rejects an end that cannot be read', () => {
    const parsed = inheritedSpendFrom({ daily_budget: '1000', start_time: START, end_time: 'soon' }, null)
    expect(parsed.ok).toBe(false)
  })
})
