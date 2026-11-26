/**
 * Earnings simulator: numbers worked out by hand from the rules, so the page's examples are checked
 * against arithmetic, not against the engine's own output.
 */
import { describe, expect, it } from 'vitest'
import { NO_OWN_SALES_EXAMPLE, SIMULATION_EXAMPLES, SIMULATION_LIMITS, formatDollars, simulateMonth } from '../simulate'

describe('simulateMonth', () => {
  it('starter: retail 5 × 799 × 20% plus peer 15 × 799 × 5%, no team below $50k', () => {
    const r = simulateMonth(SIMULATION_EXAMPLES[0].input)
    expect(r.retailCents).toBe(79_900) // 5 × 79,900 × 20%
    expect(r.peerCents).toBe(59_925) // 15 × 79,900 × 5%
    expect(r.teamSalesCents).toBe(1_598_000)
    expect(r.teamCents).toBe(0)
    expect(r.totalCents).toBe(139_825)
  })

  it('small team: tier1 over standard downline gets no peer, team 90 × 799 × 6%', () => {
    const r = simulateMonth(SIMULATION_EXAMPLES[1].input)
    expect(r.retailCents).toBe(239_700) // 10 × 79,900 × 30%
    expect(r.peerCents).toBe(0)
    expect(r.teamSalesCents).toBe(7_191_000)
    expect(r.teamRateBp).toBe(600)
    expect(r.teamCents).toBe(431_460) // 71,910 × 6%; each child is below $50k so nothing subtracted
    expect(r.eachDirectCents).toBe(127_840) // 8 × 799 × 20%
    expect(r.totalCents).toBe(671_160)
  })

  it('large team: 220 × 799 = $175,780 → 8%', () => {
    const r = simulateMonth(SIMULATION_EXAMPLES[2].input)
    expect(r.retailCents).toBe(559_300) // 20 × 79,900 × 35%
    expect(r.teamRateBp).toBe(800)
    expect(r.teamCents).toBe(1_406_240) // 17,578,000 × 8%
    expect(r.totalCents).toBe(1_965_540)
  })

  it('subtracts a downline team reward when a direct distributor reaches a step themselves', () => {
    // One child sells 70 × 799 = $55,930 → child earns 6% team on it; I (100 more) reach $135,830 → 6%.
    const r = simulateMonth({ myLevel: 'tier1', planCode: 'videos-16', mySales: 100, directCount: 1, directLevel: 'tier1', salesEach: 70 })
    expect(r.teamSalesCents).toBe(13_583_000)
    expect(r.teamCents).toBe(Math.floor(13_583_000 * 0.06) - Math.floor(5_593_000 * 0.06))
  })

  it('withholds the team reward when I sold nothing myself', () => {
    const r = simulateMonth(NO_OWN_SALES_EXAMPLE)
    expect(r.retailCents).toBe(0)
    expect(r.peerCents).toBe(319_600) // 80 × 79,900 × 5%
    expect(r.teamCents).toBe(0)
    expect(r.teamWithheldCents).toBe(383_520) // 63,920 × 6%
    expect(r.totalCents).toBe(319_600)
  })

  it('clamps nonsense input instead of throwing', () => {
    const r = simulateMonth({ myLevel: 'standard', planCode: 'nope', mySales: -3, directCount: 1e9, directLevel: 'standard', salesEach: Number.NaN })
    expect(r.totalCents).toBe(0)
    expect(r.planMonthlyCents).toBeGreaterThan(0)
    expect(SIMULATION_LIMITS.maxDirect).toBeLessThanOrEqual(50)
  })

  it('formats NZD amounts the way the page shows them', () => {
    expect(formatDollars(671_160)).toBe('$6,711.60')
    expect(formatDollars(79_900, true)).toBe('$799')
  })
})
