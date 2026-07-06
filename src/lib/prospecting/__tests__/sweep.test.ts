import { describe, it, expect } from 'vitest'
import { pickStage, leastCoveredCombo, buildCombos, type Combo } from '../sweep'

describe('pickStage — drain the pipeline before pulling more in', () => {
  it('audits first when raw discoveries are waiting', () => {
    expect(pickStage({ discovered: 3, qualified: 5, draftable: 2 })).toBe('audit')
  })

  it('analyzes qualified prospects once discoveries are drained', () => {
    expect(pickStage({ discovered: 0, qualified: 4, draftable: 0 })).toBe('analyze')
  })

  it('drafts when only analyzed prospects remain', () => {
    expect(pickStage({ discovered: 0, qualified: 0, draftable: 6 })).toBe('draft')
  })

  it('discovers a new seed only when everything else is empty', () => {
    expect(pickStage({ discovered: 0, qualified: 0, draftable: 0 })).toBe('discover')
  })

  it('skips analyze (moves to draft/discover) when the AI budget is spent', () => {
    expect(pickStage({ discovered: 0, qualified: 9, draftable: 2 }, false)).toBe('draft')
    expect(pickStage({ discovered: 0, qualified: 9, draftable: 0 }, false)).toBe('discover')
  })
})

describe('buildCombos', () => {
  it('covers only NZ cities (NZ market first) × every industry', () => {
    const combos = buildCombos()
    const cities = new Set(combos.map(c => c.city))
    expect(cities).toEqual(new Set(['auckland', 'wellington', 'christchurch', 'hamilton']))
    // 18 industries × 4 NZ cities
    expect(combos.length).toBe(18 * 4)
  })
})

describe('leastCoveredCombo — spread coverage evenly', () => {
  const combos: Combo[] = [
    { industry: 'dentists', city: 'auckland' },
    { industry: 'lawyers', city: 'wellington' },
    { industry: 'plumbers', city: 'hamilton' },
  ]

  it('picks the seed with the fewest existing prospects', () => {
    const coverage = { 'dentists|auckland': 40, 'lawyers|wellington': 5, 'plumbers|hamilton': 12 }
    expect(leastCoveredCombo(combos, coverage)).toEqual({ industry: 'lawyers', city: 'wellington' })
  })

  it('treats an unseen seed as zero coverage', () => {
    const coverage = { 'dentists|auckland': 40, 'lawyers|wellington': 5 }
    expect(leastCoveredCombo(combos, coverage)).toEqual({ industry: 'plumbers', city: 'hamilton' })
  })

  it('returns null with no combos', () => {
    expect(leastCoveredCombo([], {})).toBeNull()
  })
})
