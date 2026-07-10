import { describe, it, expect, afterEach } from 'vitest'
import {
  pickStage, leastCoveredCombo, pickDiscoverCombo, buildCombos,
  sweepIndustries, sweepCities, FOCUS_INDUSTRIES, FOCUS_CITIES, type Combo,
} from '../sweep'

describe('pickDiscoverCombo — rotate by least-recently-attempted, idle when all fresh', () => {
  const combos: Combo[] = [
    { industry: 'plumbers', city: 'auckland' },
    { industry: 'roofing', city: 'auckland' },
    { industry: 'flooring', city: 'auckland' },
  ]
  const HOUR = 60 * 60 * 1000
  const COOLDOWN = 24 * HOUR
  const now = 1_000_000_000_000

  it('picks a never-attempted combo first (time 0 sorts before any timestamp)', () => {
    // roofing + flooring attempted recently; plumbers never → plumbers wins.
    const last = { 'roofing|auckland': now - HOUR, 'flooring|auckland': now - 2 * HOUR }
    expect(pickDiscoverCombo(combos, last, now, COOLDOWN)).toEqual({ industry: 'plumbers', city: 'auckland' })
  })

  it('picks the least-recently-attempted when all have been attempted', () => {
    const last = {
      'plumbers|auckland': now - 30 * HOUR,   // oldest, past cooldown
      'roofing|auckland':  now - 10 * HOUR,
      'flooring|auckland': now - 5 * HOUR,
    }
    expect(pickDiscoverCombo(combos, last, now, COOLDOWN)).toEqual({ industry: 'plumbers', city: 'auckland' })
  })

  it('returns null (idle — no Places spend) when every combo was attempted within the cooldown', () => {
    const last = {
      'plumbers|auckland': now - 1 * HOUR,
      'roofing|auckland':  now - 2 * HOUR,
      'flooring|auckland': now - 3 * HOUR,
    }
    expect(pickDiscoverCombo(combos, last, now, COOLDOWN)).toBeNull()
  })

  it('re-sweeps a combo once its cooldown elapses', () => {
    const last = {
      'plumbers|auckland': now - 25 * HOUR,   // just past 24h cooldown
      'roofing|auckland':  now - 2 * HOUR,
      'flooring|auckland': now - 3 * HOUR,
    }
    expect(pickDiscoverCombo(combos, last, now, COOLDOWN)).toEqual({ industry: 'plumbers', city: 'auckland' })
  })

  it('returns null for an empty combo list', () => {
    expect(pickDiscoverCombo([], {}, now, COOLDOWN)).toBeNull()
  })
})

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
  it('covers the Auckland sub-areas (in-person founding offer) × the focus industries', () => {
    const combos = buildCombos([...FOCUS_INDUSTRIES], [...FOCUS_CITIES])
    expect(new Set(combos.map(c => c.city))).toEqual(
      new Set(['north_shore', 'west_auckland', 'south_auckland', 'east_auckland', 'central_auckland']),
    )
    expect(combos.length).toBe(FOCUS_INDUSTRIES.length * FOCUS_CITIES.length)
  })

  it('excludes foreign-market-skewed industries from the first wave', () => {
    const industries = new Set(buildCombos([...FOCUS_INDUSTRIES]).map(c => c.industry))
    expect(industries.has('education_consultants')).toBe(false)
    expect(industries.has('travel_agencies')).toBe(false)
  })

  it('drops unknown industry keys instead of seeding a labelless search', () => {
    const combos = buildCombos(['plumbers', 'not_a_real_industry'])
    expect(new Set(combos.map(c => c.industry))).toEqual(new Set(['plumbers']))
  })

  it('drops unknown city keys instead of seeding a coordinate-less city', () => {
    const combos = buildCombos(['plumbers'], ['auckland', 'not_a_city'])
    expect(new Set(combos.map(c => c.city))).toEqual(new Set(['auckland']))
  })
})

describe('sweepCities — env override', () => {
  const original = process.env.SWEEP_CITIES
  afterEach(() => {
    if (original === undefined) delete process.env.SWEEP_CITIES
    else process.env.SWEEP_CITIES = original
  })

  it('defaults to the Auckland sub-areas when the env is unset', () => {
    delete process.env.SWEEP_CITIES
    expect(sweepCities()).toEqual(['north_shore', 'west_auckland', 'south_auckland', 'east_auckland', 'central_auckland'])
  })

  it('honours a valid override for a later expansion, dropping unknown keys', () => {
    process.env.SWEEP_CITIES = 'auckland, wellington, atlantis'
    expect(sweepCities()).toEqual(['auckland', 'wellington'])
  })

  it('falls back to the Auckland sub-areas when the override has no valid keys', () => {
    process.env.SWEEP_CITIES = 'atlantis'
    expect(sweepCities()).toEqual(['north_shore', 'west_auckland', 'south_auckland', 'east_auckland', 'central_auckland'])
  })
})

describe('sweepIndustries — env override', () => {
  const original = process.env.SWEEP_INDUSTRIES
  afterEach(() => {
    if (original === undefined) delete process.env.SWEEP_INDUSTRIES
    else process.env.SWEEP_INDUSTRIES = original
  })

  it('defaults to the focus list when the env is unset', () => {
    delete process.env.SWEEP_INDUSTRIES
    expect(sweepIndustries()).toEqual([...FOCUS_INDUSTRIES])
  })

  it('honours a valid comma-separated override, dropping unknown keys', () => {
    process.env.SWEEP_INDUSTRIES = 'dentists, lawyers , not_real'
    expect(sweepIndustries()).toEqual(['dentists', 'lawyers'])
  })

  it('falls back to the focus list when the override has no valid keys', () => {
    process.env.SWEEP_INDUSTRIES = 'not_real, also_fake'
    expect(sweepIndustries()).toEqual([...FOCUS_INDUSTRIES])
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
