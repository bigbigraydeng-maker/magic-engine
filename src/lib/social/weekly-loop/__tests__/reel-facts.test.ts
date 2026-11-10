import { describe, expect, it } from 'vitest'
import type { FactItem } from '../fact-check'
import {
  checkReelFacts,
  factCheckToday,
  factProblemLines,
  reelLinkUrlOf,
  reelOverlayOf,
  type OkFactSource,
} from '../reel-facts'

const SOURCE: OkFactSource = { ok: true, catalogVersion: 13, tours: [], aliasesByTourId: {} }

describe('factCheckToday', () => {
  it('uses the NZ calendar date', () => {
    expect(factCheckToday(new Date('2026-11-04T12:00:00Z'))).toBe('2026-11-05')
  })
})

describe('reelOverlayOf', () => {
  it('trims a non-empty caption', () => {
    expect(reelOverlayOf({ caption: '  A  ' })).toBe('A')
  })

  it('returns null when there is no caption', () => {
    expect(reelOverlayOf({})).toBeNull()
    expect(reelOverlayOf(null)).toBeNull()
  })
})

describe('reelLinkUrlOf', () => {
  it('reads the endcard url', () => {
    expect(reelLinkUrlOf({ copy: { endcard: { url: 'https://x/y' } } })).toBe('https://x/y')
  })

  it('returns null when there is no endcard', () => {
    expect(reelLinkUrlOf({})).toBeNull()
  })
})

describe('checkReelFacts', () => {
  it('checks the catalog version and reports no overlay', () => {
    const { result, overlayChecked } = checkReelFacts({
      brief: {},
      output: {},
      orderId: 'order-1',
      source: SOURCE,
      today: '2026-11-05',
    })
    expect(result.catalogVersion).toBe(13)
    expect(overlayChecked).toBe(false)
  })

  it('reports the overlay as checked when present', () => {
    const { overlayChecked } = checkReelFacts({
      brief: {},
      output: { caption: 'TEN DAYS' },
      orderId: 'order-1',
      source: SOURCE,
      today: '2026-11-05',
    })
    expect(overlayChecked).toBe(true)
  })

  it('skips the overlay when only the first comment is checked', () => {
    const { overlayChecked } = checkReelFacts({
      brief: {},
      output: { caption: 'X' },
      orderId: 'order-1',
      source: SOURCE,
      today: '2026-11-05',
      only: 'first_comment',
    })
    expect(overlayChecked).toBe(false)
  })
})

describe('factProblemLines', () => {
  const items: FactItem[] = [
    {
      kind: 'duration_days',
      claim: '16 days',
      source: 'overlay',
      outcome: 'FAIL',
      expected: '19 days',
    },
    {
      kind: 'money',
      claim: 'NZD (7,349)',
      source: 'caption',
      outcome: 'FAIL',
      expected: null,
    },
    {
      kind: 'hotel_stars',
      claim: '5 stars',
      source: 'caption',
      outcome: 'PASS',
      expected: '5 stars',
    },
    {
      kind: 'date',
      claim: '26 March',
      source: 'caption',
      outcome: 'NEEDS_HUMAN',
      expected: null,
    },
    {
      kind: 'cruise_name',
      claim: 'Victoria',
      source: 'caption',
      outcome: 'FAIL',
      expected: 'Century',
    },
  ]

  it('returns at most three lines, skipping passes', () => {
    const lines = factProblemLines(items)
    expect(lines).toHaveLength(3)
    expect(lines[0]).toBe('天数：16 days，目录是 19 days')
    expect(lines[1]).not.toContain('(')
    expect(lines[1]).not.toContain(')')
  })

  it('honours the max argument', () => {
    expect(factProblemLines(items, 1)).toHaveLength(1)
  })
})
