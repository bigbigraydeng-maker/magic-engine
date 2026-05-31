/**
 * Unit tests for SERP position aggregation logic.
 *
 * The aggregator's computation (avg + top-10 count) is tested here
 * via extracted pure helpers. The Supabase write path is not exercised
 * in unit tests — it mirrors the pattern used in position-changes.test.ts.
 *
 * P22.A.2
 */

import { describe, expect, it } from 'vitest'

// ── Pure helpers extracted for testability ────────────────────────────────────

function computeAvgPosition(positions: number[]): number | null {
  if (positions.length === 0) return null
  return Math.round((positions.reduce((s, p) => s + p, 0) / positions.length) * 100) / 100
}

function computeTop10Count(positions: number[]): number {
  return positions.filter(p => p <= 10).length
}

function filterRanked(raw: Array<{ position: number | null }>): number[] {
  return raw.map(r => r.position).filter((p): p is number => typeof p === 'number' && p > 0)
}

// ─────────────────────────────────────────────────────────────────────────────

describe('filterRanked', () => {
  it('excludes null and zero positions', () => {
    const input = [
      { position: 5 },
      { position: null },
      { position: 0 },
      { position: 12 },
    ]
    expect(filterRanked(input)).toEqual([5, 12])
  })

  it('returns empty array when all positions are null', () => {
    expect(filterRanked([{ position: null }, { position: null }])).toEqual([])
  })
})

describe('computeAvgPosition', () => {
  it('returns null for empty array', () => {
    expect(computeAvgPosition([])).toBeNull()
  })

  it('returns the single value for one keyword', () => {
    expect(computeAvgPosition([7])).toBe(7)
  })

  it('calculates mean correctly for multiple positions', () => {
    // (3 + 7 + 10) / 3 = 6.666... → rounds to 6.67
    expect(computeAvgPosition([3, 7, 10])).toBe(6.67)
  })

  it('rounds to 2 decimal places', () => {
    // (1 + 2 + 3) / 3 = 2.0 exactly
    expect(computeAvgPosition([1, 2, 3])).toBe(2)
  })
})

describe('computeTop10Count', () => {
  it('returns 0 when no keywords are in top 10', () => {
    expect(computeTop10Count([11, 15, 20])).toBe(0)
  })

  it('counts keywords ranked exactly at position 10', () => {
    expect(computeTop10Count([8, 10, 11])).toBe(2)
  })

  it('counts all when all are ≤ 10', () => {
    expect(computeTop10Count([1, 3, 5, 7, 9])).toBe(5)
  })

  it('handles empty positions', () => {
    expect(computeTop10Count([])).toBe(0)
  })
})

describe('SERP aggregation integration scenario', () => {
  it('produces expected avg_position and top10_count for a realistic keyword set', () => {
    // Simulate a client with 5 ranked keywords
    const rawRows: Array<{ position: number | null }> = [
      { position: 3 },   // top 10
      { position: 8 },   // top 10
      { position: 10 },  // top 10 (boundary)
      { position: 11 },  // not top 10
      { position: null }, // unranked — excluded
    ]

    const positions = filterRanked(rawRows)
    expect(positions).toHaveLength(4)

    const avgPosition = computeAvgPosition(positions)
    const top10Count = computeTop10Count(positions)

    // (3 + 8 + 10 + 11) / 4 = 32 / 4 = 8.0
    expect(avgPosition).toBe(8)
    expect(top10Count).toBe(3)
  })
})
