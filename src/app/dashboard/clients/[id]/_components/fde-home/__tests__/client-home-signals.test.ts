import { describe, expect, it } from 'vitest'
import { executionProgressTone, summarizeLiveSpend, toneForAdVerdict } from '../client-home-signals'

describe('client-home-signals', () => {
  it('maps ad verdicts to status tones', () => {
    expect(toneForAdVerdict('alert')).toBe('rej')
    expect(toneForAdVerdict('healthy')).toBe('track')
  })

  it('sums live spend when present', () => {
    const { spend, budget } = summarizeLiveSpend([
      { active: [{ spendToday: 10, dailyBudget: 50 }, { spendToday: 5, dailyBudget: null }] },
    ])
    expect(spend).toBe(15)
    expect(budget).toBe(50)
  })

  it('scores execution progress', () => {
    expect(executionProgressTone(8, 2)).toBe('track')
    expect(executionProgressTone(1, 9)).toBe('rej')
  })
})
