import { describe, expect, it, vi, beforeEach } from 'vitest'

const loadMock = vi.fn()
vi.mock('@/lib/tour-catalog/store-publish', () => ({
  loadPublishedTourFacts: (...args: unknown[]) => loadMock(...args),
}))

import { deriveAliases, loadSocialFactSource, nameSuffix } from '../fact-aliases'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { PublishedTourFact } from '@/lib/tour-catalog/publish-contract'

function asDb(value: object): SupabaseClient {
  return value as SupabaseClient
}

function tour(id: string, name: string): PublishedTourFact {
  return {
    id,
    slug: id,
    destination: 'x',
    tier: 't',
    name,
    title: null,
    durationText: null,
    displayPriceText: null,
    highlights: [],
    inclusions: [],
    exclusions: [],
    singleSupplement: null,
    soldOut: false,
    managesDepartures: false,
    isActive: true,
    departures: [],
  }
}

interface FakeQueryResult {
  data: unknown
  error: unknown
}

function makeFakeDb(result: FakeQueryResult): {
  db: SupabaseClient
  from: ReturnType<typeof vi.fn>
} {
  const from = vi.fn()
  const chain = {
    select: () => chain,
    eq: () => chain,
    order: () => chain,
    limit: () => Promise.resolve(result),
  }
  from.mockReturnValue(chain)
  return { db: asDb({ from }), from }
}

beforeEach(() => {
  loadMock.mockReset()
})

describe('nameSuffix', () => {
  it('returns the last segment after an em dash', () => {
    expect(nameSuffix('Brand Line — Mountain Loop')).toBe('Mountain Loop')
  })

  it('returns the last segment after a hyphen', () => {
    expect(nameSuffix('Brand Line - Mountain Loop')).toBe('Mountain Loop')
  })

  it('returns the last segment after an en dash', () => {
    expect(nameSuffix('Brand Line – Mountain Loop')).toBe('Mountain Loop')
  })

  it('returns the whole trimmed name when there is no dash', () => {
    expect(nameSuffix('Mountain Loop')).toBe('Mountain Loop')
  })
})

describe('deriveAliases', () => {
  it('collects earlier full name then suffix for a renamed tour', () => {
    const snapshots = [
      {
        version: 2,
        tours: [{ id: 't1', name: 'Brand Line — Valley Rim' }],
      },
      {
        version: 1,
        tours: [{ id: 't1', name: 'Brand Line — Valley Edge' }],
      },
    ]
    const current = [{ id: 't1', name: 'Brand Line — Valley Rim' }]

    const result = deriveAliases(snapshots, current)

    expect(result['t1']).toEqual(['Brand Line — Valley Edge', 'Valley Edge'])
  })

  it('produces no key when names are unchanged', () => {
    const snapshots = [
      { version: 1, tours: [{ id: 't1', name: 'Brand Line — Valley Rim' }] },
    ]
    const current = [{ id: 't1', name: 'Brand Line — Valley Rim' }]

    const result = deriveAliases(snapshots, current)

    expect(result).toEqual({})
  })

  it('collects an earlier differing title', () => {
    const snapshots = [
      {
        version: 1,
        tours: [
          {
            id: 't1',
            name: 'Brand Line — Valley Rim',
            title: 'Old Title Text',
          },
        ],
      },
    ]
    const current = [
      {
        id: 't1',
        name: 'Brand Line — Valley Rim',
        title: 'New Title Text',
      },
    ]

    const result = deriveAliases(snapshots, current)

    expect(result['t1']).toContain('Old Title Text')
  })

  it('drops candidates that match another current tour name or suffix', () => {
    const snapshots = [
      {
        version: 1,
        tours: [{ id: 't1', name: 'Brand Line — Harbour Walk' }],
      },
    ]
    const current = [
      { id: 't1', name: 'Brand Line — Valley Rim' },
      { id: 't2', name: 'Brand Line — Harbour Walk' },
    ]

    const result = deriveAliases(snapshots, current)

    expect(result['t1']).toBeUndefined()
  })

  it('skips candidates shorter than 4 chars and dedupes case-insensitively', () => {
    const snapshots = [
      { version: 2, tours: [{ id: 't1', name: 'Abc' }] },
      { version: 1, tours: [{ id: 't1', name: 'Valley Edge' }] },
      { version: 0, tours: [{ id: 't1', name: 'valley edge' }] },
    ]
    const current = [{ id: 't1', name: 'Brand Line — Valley Rim' }]

    const result = deriveAliases(snapshots, current)

    expect(result['t1']).toEqual(['Valley Edge'])
  })
})

describe('loadSocialFactSource', () => {
  it('returns ok with catalog version and aliases on the happy path', async () => {
    loadMock.mockResolvedValue({
      published: true,
      version: 7,
      tours: [tour('t1', 'Brand Line — Valley Rim')],
    })
    const { db, from } = makeFakeDb({
      data: [
        {
          version: 7,
          snapshot: { tours: [{ id: 't1', name: 'Brand Line — Valley Rim' }] },
        },
        {
          version: 6,
          snapshot: { tours: [{ id: 't1', name: 'Brand Line — Valley Edge' }] },
        },
      ],
      error: null,
    })

    const result = await loadSocialFactSource(db, 'client-1', '2024-01-01')

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.catalogVersion).toBe(7)
      expect(result.aliasesByTourId['t1']).toContain('Valley Edge')
    }
    expect(from).toHaveBeenCalledWith('tour_catalog_published')
  })

  it('returns catalog_not_published when the catalog is not published', async () => {
    loadMock.mockResolvedValue({ published: false })
    const { db } = makeFakeDb({ data: [], error: null })

    const result = await loadSocialFactSource(db, 'client-1', '2024-01-01')

    expect(result).toEqual({ ok: false, reason: 'catalog_not_published' })
  })

  it('returns catalog_empty when there are no tours', async () => {
    loadMock.mockResolvedValue({ published: true, version: 1, tours: [] })
    const { db } = makeFakeDb({ data: [], error: null })

    const result = await loadSocialFactSource(db, 'client-1', '2024-01-01')

    expect(result).toEqual({ ok: false, reason: 'catalog_empty' })
  })

  it('returns snapshot_read_failed when the snapshot query errors', async () => {
    loadMock.mockResolvedValue({
      published: true,
      version: 1,
      tours: [tour('t1', 'Brand Line — Valley Rim')],
    })
    const { db } = makeFakeDb({ data: null, error: { message: 'boom' } })

    const result = await loadSocialFactSource(db, 'client-1', '2024-01-01')

    expect(result).toEqual({ ok: false, reason: 'snapshot_read_failed' })
  })

  it('returns load_failed when the loader rejects', async () => {
    loadMock.mockRejectedValue(new Error('nope'))
    const { db } = makeFakeDb({ data: [], error: null })

    const result = await loadSocialFactSource(db, 'client-1', '2024-01-01')

    expect(result).toEqual({ ok: false, reason: 'load_failed' })
  })

  it('skips malformed snapshot rows without throwing', async () => {
    loadMock.mockResolvedValue({
      published: true,
      version: 3,
      tours: [tour('t1', 'Brand Line — Valley Rim')],
    })
    const { db } = makeFakeDb({
      data: [
        { version: 3, snapshot: null },
        { version: 2, snapshot: { tours: 'x' } },
        { version: 1, snapshot: { tours: [{ name: 'no id here' }] } },
      ],
      error: null,
    })

    const result = await loadSocialFactSource(db, 'client-1', '2024-01-01')

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.aliasesByTourId).toEqual({})
    }
  })
})
