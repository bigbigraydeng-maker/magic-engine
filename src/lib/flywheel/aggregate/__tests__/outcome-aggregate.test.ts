/**
 * Tests for outcome-aggregate.ts — P12.C.1
 */

import { describe, it, expect } from 'vitest'
import {
  computeVerdictStats,
  buildAggregateRows,
  pickTop,
} from '../outcome-aggregate'
import type { OutcomeRow, AggregateEntry } from '../outcome-aggregate'

// ── computeVerdictStats ───────────────────────────────────────────────────────

describe('computeVerdictStats', () => {
  it('returns zero counts for empty input', () => {
    const stats = computeVerdictStats([])
    expect(stats.total).toBe(0)
    expect(stats.confirmed).toBe(0)
    expect(stats.inconclusive).toBe(0)
    expect(stats.reversed).toBe(0)
    expect(stats.decided).toBe(0)
    expect(stats.confirmed_rate).toBe(0)
  })

  it('counts verdicts correctly', () => {
    const rows: OutcomeRow[] = [
      { action_type: 'geo.deploy_directive', verdict: 'confirmed' },
      { action_type: 'geo.deploy_directive', verdict: 'confirmed' },
      { action_type: 'geo.deploy_directive', verdict: 'inconclusive' },
      { action_type: 'geo.deploy_directive', verdict: 'reversed' },
    ]
    const stats = computeVerdictStats(rows)
    expect(stats.total).toBe(4)
    expect(stats.confirmed).toBe(2)
    expect(stats.inconclusive).toBe(1)
    expect(stats.reversed).toBe(1)
    expect(stats.decided).toBe(3)
    expect(stats.confirmed_rate).toBeCloseTo(2 / 3)
  })

  it('handles all confirmed', () => {
    const rows: OutcomeRow[] = [
      { action_type: 'seo.publish_blog', verdict: 'confirmed' },
      { action_type: 'seo.publish_blog', verdict: 'confirmed' },
    ]
    const stats = computeVerdictStats(rows)
    expect(stats.confirmed_rate).toBe(1)
  })
})

// ── buildAggregateRows ────────────────────────────────────────────────────────

describe('buildAggregateRows', () => {
  it('groups rows by action_type', () => {
    const rows: OutcomeRow[] = [
      { action_type: 'geo.deploy_directive', verdict: 'confirmed' },
      { action_type: 'geo.deploy_directive', verdict: 'inconclusive' },
      { action_type: 'seo.publish_blog', verdict: 'confirmed' },
    ]
    const result = buildAggregateRows(rows)
    expect(result).toHaveLength(2)
    const geo = result.find(r => r.action_type === 'geo.deploy_directive')!
    expect(geo.total).toBe(2)
    const seo = result.find(r => r.action_type === 'seo.publish_blog')!
    expect(seo.total).toBe(1)
    expect(seo.confirmed_rate).toBe(1)
  })

  it('returns empty array for empty input', () => {
    expect(buildAggregateRows([])).toEqual([])
  })
})

// ── pickTop ───────────────────────────────────────────────────────────────────

describe('pickTop', () => {
  const entries: AggregateEntry[] = [
    { action_type: 'a', confirmed: 5, inconclusive: 2, reversed: 1, total: 8, decided: 6, confirmed_rate: 5 / 6 },
    { action_type: 'b', confirmed: 9, inconclusive: 1, reversed: 0, total: 10, decided: 9, confirmed_rate: 1 },
    { action_type: 'c', confirmed: 1, inconclusive: 8, reversed: 1, total: 10, decided: 2, confirmed_rate: 0.5 },
    { action_type: 'd', confirmed: 7, inconclusive: 2, reversed: 1, total: 10, decided: 8, confirmed_rate: 7 / 8 },
    { action_type: 'e', confirmed: 3, inconclusive: 3, reversed: 4, total: 10, decided: 7, confirmed_rate: 3 / 7 },
    { action_type: 'f', confirmed: 8, inconclusive: 1, reversed: 1, total: 10, decided: 9, confirmed_rate: 8 / 9 },
  ]

  it('returns top N by confirmed_rate, descending', () => {
    const top5 = pickTop(entries, 5)
    expect(top5).toHaveLength(5)
    expect(top5[0].action_type).toBe('b')  // 1.0
    expect(top5[1].action_type).toBe('f')  // 0.89
    expect(top5[2].action_type).toBe('d')  // 0.875
    expect(top5[3].action_type).toBe('a')  // 0.83
    expect(top5[4].action_type).toBe('e')  // 0.43
  })

  it('excludes entries with too few decided cases', () => {
    const sparse: AggregateEntry[] = [
      { action_type: 'x', confirmed: 1, inconclusive: 0, reversed: 0, total: 1, decided: 1, confirmed_rate: 1 },
      { action_type: 'y', confirmed: 2, inconclusive: 0, reversed: 0, total: 2, decided: 2, confirmed_rate: 1 },
    ]
    const top = pickTop(sparse, 5, 2)
    expect(top).toHaveLength(1)
    expect(top[0].action_type).toBe('y')
  })

  it('ranks by decided cases, not by all cases', () => {
    const mostlyUnknown = [
      { action_type: 'u', confirmed: 1, inconclusive: 99, reversed: 0, total: 100, decided: 1, confirmed_rate: 1 },
      { action_type: 'v', confirmed: 3, inconclusive: 0, reversed: 1, total: 4, decided: 4, confirmed_rate: 0.75 },
    ]
    expect(pickTop(mostlyUnknown, 5).map(e => e.action_type)).toEqual(['v'])
  })

  it('an action type with nothing decided never ranks', () => {
    const allUnknown = [
      { action_type: 'w', confirmed: 0, inconclusive: 10, reversed: 0, total: 10, decided: 0, confirmed_rate: 0 },
    ]
    expect(pickTop(allUnknown, 5, 1)).toEqual([])
  })
})
