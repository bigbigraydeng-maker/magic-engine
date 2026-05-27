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
    expect(stats.confirmed_rate).toBeCloseTo(0.5)
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
    { action_type: 'a', confirmed: 5, inconclusive: 2, reversed: 1, total: 8, confirmed_rate: 0.625 },
    { action_type: 'b', confirmed: 9, inconclusive: 1, reversed: 0, total: 10, confirmed_rate: 0.9 },
    { action_type: 'c', confirmed: 1, inconclusive: 8, reversed: 1, total: 10, confirmed_rate: 0.1 },
    { action_type: 'd', confirmed: 7, inconclusive: 2, reversed: 1, total: 10, confirmed_rate: 0.7 },
    { action_type: 'e', confirmed: 3, inconclusive: 3, reversed: 4, total: 10, confirmed_rate: 0.3 },
    { action_type: 'f', confirmed: 8, inconclusive: 1, reversed: 1, total: 10, confirmed_rate: 0.8 },
  ]

  it('returns top N by confirmed_rate, descending', () => {
    const top5 = pickTop(entries, 5)
    expect(top5).toHaveLength(5)
    expect(top5[0].action_type).toBe('b')  // 0.9
    expect(top5[1].action_type).toBe('f')  // 0.8
    expect(top5[2].action_type).toBe('d')  // 0.7
    expect(top5[3].action_type).toBe('a')  // 0.625
    expect(top5[4].action_type).toBe('e')  // 0.3
  })

  it('excludes low-sample entries by default (min_total=2)', () => {
    const sparse: AggregateEntry[] = [
      { action_type: 'x', confirmed: 1, inconclusive: 0, reversed: 0, total: 1, confirmed_rate: 1 },
      { action_type: 'y', confirmed: 2, inconclusive: 0, reversed: 0, total: 2, confirmed_rate: 1 },
    ]
    const top = pickTop(sparse, 5, 2)
    expect(top).toHaveLength(1)
    expect(top[0].action_type).toBe('y')
  })
})
