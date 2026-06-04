/**
 * Unit tests for the competitor resolver — the single read entry for
 * clients.competitor_domains, master_briefs.competitor_domains, and
 * (optional) DataForSEO auto-discovery.
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
  normaliseDomain,
  getClientCompetitors,
  getClientCompetitorDomains,
} from '../resolver'

const CLIENT = 'client-uuid-001'

describe('normaliseDomain', () => {
  it('strips scheme, trailing slash, query, and lowercases', () => {
    expect(normaliseDomain('HTTPS://Example.com/')).toBe('example.com')
    expect(normaliseDomain('http://foo.com/path/x?q=1')).toBe('foo.com')
    expect(normaliseDomain('  bar.com.au  ')).toBe('bar.com.au')
    expect(normaliseDomain('www.baz.co.nz#anchor')).toBe('www.baz.co.nz')
  })

  it('returns empty for non-strings or empty input', () => {
    expect(normaliseDomain('')).toBe('')
    // @ts-expect-error testing runtime guard
    expect(normaliseDomain(null)).toBe('')
    // @ts-expect-error testing runtime guard
    expect(normaliseDomain(42)).toBe('')
  })
})

describe('getClientCompetitors — priority order', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns FDE list first, then brief, then auto, deduplicated', async () => {
    mockClientMaybeSingle.mockResolvedValue({
      data: { competitor_domains: ['fde-one.com', 'shared.com'] },
      error: null,
    })
    mockBriefMaybeSingle.mockResolvedValue({
      data: { competitor_domains: ['brief-one.com', 'shared.com'] },
      error: null,
    })

    const result = await getClientCompetitors(CLIENT, ['auto-one.com', 'fde-one.com'], 5)

    expect(result.domains).toEqual([
      'fde-one.com',
      'shared.com',
      'brief-one.com',
      'auto-one.com',
    ])
    expect(result.sources['fde-one.com']).toBe('fde')
    expect(result.sources['shared.com']).toBe('fde')        // first source wins
    expect(result.sources['brief-one.com']).toBe('brief')
    expect(result.sources['auto-one.com']).toBe('auto')
  })

  it('normalises domains from all sources before merging', async () => {
    mockClientMaybeSingle.mockResolvedValue({
      data: { competitor_domains: ['HTTPS://Foo.com/'] },
      error: null,
    })
    mockBriefMaybeSingle.mockResolvedValue({
      data: { competitor_domains: ['foo.com'] },
      error: null,
    })

    const result = await getClientCompetitors(CLIENT, [], 5)

    expect(result.domains).toEqual(['foo.com'])
    expect(result.sources['foo.com']).toBe('fde')
  })

  it('falls back to brief when client has no list', async () => {
    mockClientMaybeSingle.mockResolvedValue({ data: { competitor_domains: null }, error: null })
    mockBriefMaybeSingle.mockResolvedValue({
      data: { competitor_domains: ['brief-only.com'] },
      error: null,
    })

    const result = await getClientCompetitors(CLIENT, [], 5)

    expect(result.domains).toEqual(['brief-only.com'])
    expect(result.sources['brief-only.com']).toBe('brief')
  })

  it('falls back to auto when neither client nor brief has list', async () => {
    mockClientMaybeSingle.mockResolvedValue({ data: null, error: null })
    mockBriefMaybeSingle.mockResolvedValue({ data: null, error: null })

    const result = await getClientCompetitors(CLIENT, ['auto-one.com', 'auto-two.com'], 5)

    expect(result.domains).toEqual(['auto-one.com', 'auto-two.com'])
    expect(result.sources['auto-one.com']).toBe('auto')
  })

  it('respects max parameter', async () => {
    mockClientMaybeSingle.mockResolvedValue({
      data: { competitor_domains: ['a.com', 'b.com', 'c.com'] },
      error: null,
    })
    mockBriefMaybeSingle.mockResolvedValue({
      data: { competitor_domains: ['d.com'] },
      error: null,
    })

    const result = await getClientCompetitors(CLIENT, ['e.com'], 2)

    expect(result.domains).toEqual(['a.com', 'b.com'])
  })

  it('returns empty when all sources are empty', async () => {
    mockClientMaybeSingle.mockResolvedValue({ data: null, error: null })
    mockBriefMaybeSingle.mockResolvedValue({ data: null, error: null })

    const result = await getClientCompetitors(CLIENT, [], 5)

    expect(result.domains).toEqual([])
    expect(Object.keys(result.sources)).toHaveLength(0)
  })
})

describe('getClientCompetitorDomains — string-array variant', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns domains array without sources map', async () => {
    mockClientMaybeSingle.mockResolvedValue({
      data: { competitor_domains: ['rival.com'] },
      error: null,
    })
    mockBriefMaybeSingle.mockResolvedValue({ data: null, error: null })

    const result = await getClientCompetitorDomains(CLIENT, [], 5)

    expect(result).toEqual(['rival.com'])
  })
})
