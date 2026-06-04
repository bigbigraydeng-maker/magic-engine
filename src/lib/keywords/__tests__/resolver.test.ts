/**
 * Unit tests for the keywords resolver — the single read entry for
 * clients.primary_keywords and master_briefs.keyword_seeds.
 *
 * Mirrors src/lib/competitors/__tests__/resolver.test.ts shape.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockClientMaybeSingle = vi.fn()
const mockClientEq          = vi.fn(() => ({ maybeSingle: mockClientMaybeSingle }))
const mockClientSelect      = vi.fn(() => ({ eq: mockClientEq }))

const mockBriefMaybeSingle = vi.fn()
const mockBriefLimit       = vi.fn(() => ({ maybeSingle: mockBriefMaybeSingle }))
const mockBriefOrder       = vi.fn(() => ({ limit: mockBriefLimit }))
const mockBriefOr          = vi.fn(() => ({ order: mockBriefOrder }))
const mockBriefEq          = vi.fn(() => ({ or: mockBriefOr }))
const mockBriefSelect      = vi.fn(() => ({ eq: mockBriefEq }))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn((table: string) => {
      if (table === 'clients')       return { select: mockClientSelect }
      if (table === 'master_briefs') return { select: mockBriefSelect }
      return {}
    }),
  },
}))

import {
  normaliseKeyword,
  getClientKeywords,
  getClientPrimaryKeywords,
} from '../resolver'

const CLIENT = 'client-uuid-001'

describe('normaliseKeyword', () => {
  it('lowercases and trims whitespace', () => {
    expect(normaliseKeyword('  Vinyl Flooring  ')).toBe('vinyl flooring')
    expect(normaliseKeyword('Carpet')).toBe('carpet')
    expect(normaliseKeyword('SPC Hybrid')).toBe('spc hybrid')
  })

  it('collapses multiple internal spaces to single space', () => {
    expect(normaliseKeyword('hybrid   flooring')).toBe('hybrid flooring')
    expect(normaliseKeyword('engineered\ttimber')).toBe('engineered timber')
  })

  it('returns empty for non-strings or empty input', () => {
    expect(normaliseKeyword('')).toBe('')
    expect(normaliseKeyword('   ')).toBe('')
    // @ts-expect-error testing runtime guard
    expect(normaliseKeyword(null)).toBe('')
    // @ts-expect-error testing runtime guard
    expect(normaliseKeyword(42)).toBe('')
  })
})

describe('getClientKeywords — priority order', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns FDE list first, then brief, deduplicated', async () => {
    mockClientMaybeSingle.mockResolvedValue({
      data: { primary_keywords: ['flooring', 'shared'] },
      error: null,
    })
    mockBriefMaybeSingle.mockResolvedValue({
      data: { keyword_seeds: ['tiles', 'shared'] },
      error: null,
    })

    const result = await getClientKeywords(CLIENT, 10)

    expect(result.keywords).toEqual(['flooring', 'shared', 'tiles'])
    expect(result.sources['flooring']).toBe('fde')
    expect(result.sources['shared']).toBe('fde')   // first source wins
    expect(result.sources['tiles']).toBe('brief')
  })

  it('normalises keywords from all sources before merging', async () => {
    mockClientMaybeSingle.mockResolvedValue({
      data: { primary_keywords: ['  Vinyl Flooring  '] },
      error: null,
    })
    mockBriefMaybeSingle.mockResolvedValue({
      data: { keyword_seeds: ['vinyl flooring'] },
      error: null,
    })

    const result = await getClientKeywords(CLIENT, 10)

    expect(result.keywords).toEqual(['vinyl flooring'])
    expect(result.sources['vinyl flooring']).toBe('fde')
  })

  it('falls back to brief when client has no list', async () => {
    mockClientMaybeSingle.mockResolvedValue({ data: { primary_keywords: null }, error: null })
    mockBriefMaybeSingle.mockResolvedValue({
      data: { keyword_seeds: ['brief-only'] },
      error: null,
    })

    const result = await getClientKeywords(CLIENT, 10)

    expect(result.keywords).toEqual(['brief-only'])
    expect(result.sources['brief-only']).toBe('brief')
  })

  it('returns empty when neither source has list', async () => {
    mockClientMaybeSingle.mockResolvedValue({ data: null, error: null })
    mockBriefMaybeSingle.mockResolvedValue({ data: null, error: null })

    const result = await getClientKeywords(CLIENT, 10)

    expect(result.keywords).toEqual([])
    expect(Object.keys(result.sources)).toHaveLength(0)
  })

  it('respects max parameter (cap from highest priority first)', async () => {
    mockClientMaybeSingle.mockResolvedValue({
      data: { primary_keywords: ['a', 'b', 'c'] },
      error: null,
    })
    mockBriefMaybeSingle.mockResolvedValue({
      data: { keyword_seeds: ['d'] },
      error: null,
    })

    const result = await getClientKeywords(CLIENT, 2)

    expect(result.keywords).toEqual(['a', 'b'])
  })

  it('skips empty / whitespace-only entries', async () => {
    mockClientMaybeSingle.mockResolvedValue({
      data: { primary_keywords: ['flooring', '   ', ''] },
      error: null,
    })
    mockBriefMaybeSingle.mockResolvedValue({ data: null, error: null })

    const result = await getClientKeywords(CLIENT, 10)

    expect(result.keywords).toEqual(['flooring'])
  })
})

describe('getClientPrimaryKeywords — string-array variant', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns keywords array without sources map', async () => {
    mockClientMaybeSingle.mockResolvedValue({
      data: { primary_keywords: ['carpet'] },
      error: null,
    })
    mockBriefMaybeSingle.mockResolvedValue({ data: null, error: null })

    const result = await getClientPrimaryKeywords(CLIENT, 10)

    expect(result).toEqual(['carpet'])
  })
})
