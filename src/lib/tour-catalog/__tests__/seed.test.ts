import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  planSeed,
  tourKey,
  fetchFirstPartyFeed,
  seedCatalog,
  feedLacksContentFields,
  type SeedPlan,
} from '../seed'
import type { FirstPartyTour, FirstPartyTourFeed } from '@/lib/web-intelligence/first-party-tours'

function makeTour(overrides: Partial<FirstPartyTour> = {}): FirstPartyTour {
  return {
    id: 't1',
    slug: 'south-island',
    destination: 'New Zealand',
    tier: 'premium',
    name: 'South Island Escape',
    title: 'South Island Escape',
    duration: '10 days',
    price: 'From NZD $4,999 per person',
    is_active: true,
    updated_at: '2026-01-01T00:00:00Z',
    departure_dates: ['13 May 2027'],
    departure_pricing: {},
    tour_cities: ['Christchurch', 'Queenstown'],
    itinerary: [{ day: 1, title: 'Arrive', description: 'Welcome' }],
    inclusions: ['Meals'],
    exclusions: ['Flights'],
    single_supplement: 'NZD $900',
    max_group_size: 16,
    ...overrides,
  }
}

function makeFeed(products: FirstPartyTour[]): FirstPartyTourFeed {
  return { source: 'test', source_version: '1', products }
}

describe('tourKey', () => {
  it('joins destination, tier and slug with slashes', () => {
    expect(tourKey({ destination: 'New Zealand', tier: 'premium', slug: 'south-island' }))
      .toBe('New Zealand/premium/south-island')
  })
})

describe('planSeed', () => {
  it('maps every field of a product into a tour row', () => {
    const plan = planSeed(makeFeed([makeTour()]), new Set())
    expect(plan.tours).toHaveLength(1)
    const row = plan.tours[0]
    expect(row.slug).toBe('south-island')
    expect(row.destination).toBe('New Zealand')
    expect(row.tier).toBe('premium')
    expect(row.name).toBe('South Island Escape')
    expect(row.title).toBe('South Island Escape')
    expect(row.duration_text).toBe('10 days')
    expect(row.display_price_text).toBe('From NZD $4,999 per person')
    expect(row.itinerary).toEqual([{ day: 1, title: 'Arrive', description: 'Welcome' }])
    expect(row.inclusions).toEqual(['Meals'])
    expect(row.exclusions).toEqual(['Flights'])
    expect(row.tour_cities).toEqual(['Christchurch', 'Queenstown'])
    expect(row.single_supplement).toBe('NZD $900')
    expect(row.max_group_size).toBe(16)
    expect(row.is_active).toBe(true)
  })

  it('defaults tier to unknown when undefined', () => {
    const plan = planSeed(makeFeed([makeTour({ tier: undefined })]), new Set())
    expect(plan.tours[0].tier).toBe('unknown')
  })

  it('sets manages_departures true when departure dates exist', () => {
    const plan = planSeed(makeFeed([makeTour({ departure_dates: ['13 May 2027'] })]), new Set())
    expect(plan.tours[0].manages_departures).toBe(true)
  })

  it('sets manages_departures false when there are no departure dates', () => {
    const plan = planSeed(makeFeed([makeTour({ departure_dates: [] })]), new Set())
    expect(plan.tours[0].manages_departures).toBe(false)
  })

  it('keeps a TBC price', () => {
    const plan = planSeed(makeFeed([makeTour({ price: 'From NZD $TBC per person' })]), new Set())
    expect(plan.tours[0].display_price_text).toBe('From NZD $TBC per person')
    expect(plan.notes).toEqual([])
  })

  it('nulls an unparseable price and records a note', () => {
    const plan = planSeed(makeFeed([makeTour({ price: 'call us' })]), new Set())
    expect(plan.tours[0].display_price_text).toBeNull()
    expect(plan.notes).toEqual([
      { tourKey: 'New Zealand/premium/south-island', note: 'price_rejected:unparseable' },
    ])
  })

  it('converts a display departure date to ISO', () => {
    const plan = planSeed(makeFeed([makeTour({ departure_dates: ['13 May 2027'] })]), new Set())
    expect(plan.departures).toHaveLength(1)
    expect(plan.departures[0].depart_on).toBe('2027-05-13')
    expect(plan.departures[0].return_on).toBeNull()
    expect(plan.departures[0].status).toBe('open')
    expect(plan.departures[0].tourKey).toBe('New Zealand/premium/south-island')
  })

  it('copies a departure pricing override', () => {
    const plan = planSeed(
      makeFeed([makeTour({ departure_pricing: { '13 May 2027': 'From NZD $5,200 per person' } })]),
      new Set(),
    )
    expect(plan.departures[0].price_text_override).toBe('From NZD $5,200 per person')
  })

  it('nulls an unparseable override and records a note', () => {
    const plan = planSeed(
      makeFeed([makeTour({ departure_pricing: { '13 May 2027': 'ask us' } })]),
      new Set(),
    )
    expect(plan.departures[0].price_text_override).toBeNull()
    expect(plan.notes).toEqual([
      {
        tourKey: 'New Zealand/premium/south-island',
        note: 'override_price_rejected:13 May 2027:unparseable',
      },
    ])
  })

  it('skips an unparseable departure date and records a note', () => {
    const plan = planSeed(makeFeed([makeTour({ departure_dates: ['sometime'] })]), new Set())
    expect(plan.departures).toEqual([])
    expect(plan.notes).toEqual([
      { tourKey: 'New Zealand/premium/south-island', note: 'departure_unparseable:sometime' },
    ])
  })

  it('skips tours whose key already exists', () => {
    const plan = planSeed(makeFeed([makeTour()]), new Set(['New Zealand/premium/south-island']))
    expect(plan.tours).toEqual([])
    expect(plan.departures).toEqual([])
    expect(plan.skippedExisting).toEqual(['New Zealand/premium/south-island'])
  })

  it('preserves product order', () => {
    const plan = planSeed(
      makeFeed([
        makeTour({ slug: 'a' }),
        makeTour({ slug: 'b' }),
        makeTour({ slug: 'c' }),
      ]),
      new Set(),
    )
    expect(plan.tours.map((t) => t.slug)).toEqual(['a', 'b', 'c'])
  })
})

describe('fetchFirstPartyFeed', () => {
  it('rejects a non-https url', async () => {
    await expect(fetchFirstPartyFeed('http://example.com/feed', vi.fn()))
      .rejects.toThrow('feed_url_must_be_https')
  })

  it('throws on a non-ok response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 500 })
    await expect(fetchFirstPartyFeed('https://example.com/feed', fetchImpl as unknown as typeof fetch))
      .rejects.toThrow('feed_http_500')
  })

  it('throws when the payload is not a valid feed', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ nope: true }),
    })
    await expect(fetchFirstPartyFeed('https://example.com/feed', fetchImpl as unknown as typeof fetch))
      .rejects.toThrow('feed_invalid')
  })

  it('throws feed_invalid on malformed JSON', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => 'not json',
    })
    await expect(fetchFirstPartyFeed('https://example.com/feed', fetchImpl as unknown as typeof fetch))
      .rejects.toThrow('feed_invalid')
  })

  it('throws feed_too_large when the body exceeds 5 MiB', async () => {
    const oversized = 'x'.repeat(5 * 1024 * 1024 + 1)
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => oversized,
    })
    await expect(fetchFirstPartyFeed('https://example.com/feed', fetchImpl as unknown as typeof fetch))
      .rejects.toThrow('feed_too_large')
  })

  it('passes redirect: error to fetchImpl', async () => {
    const feed = makeFeed([makeTour()])
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(feed),
    })
    await fetchFirstPartyFeed('https://example.com/feed', fetchImpl as unknown as typeof fetch)
    const init = fetchImpl.mock.calls[0][1] as RequestInit
    expect(init.redirect).toBe('error')
    expect(init.signal).toBeDefined()
  })

  it('returns the parsed feed on success', async () => {
    const feed = makeFeed([makeTour()])
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(feed),
    })
    const result = await fetchFirstPartyFeed('https://example.com/feed', fetchImpl as unknown as typeof fetch)
    expect(result.source).toBe('test')
    expect(result.products).toHaveLength(1)
    expect(result.products[0].slug).toBe('south-island')
  })
})

interface FakeDb {
  db: SupabaseClient
  toursInsert: ReturnType<typeof vi.fn>
  departuresInsert: ReturnType<typeof vi.fn>
  toursDelete: ReturnType<typeof vi.fn>
  toursDeleteEq: ReturnType<typeof vi.fn>
  toursDeleteIn: ReturnType<typeof vi.fn>
}

/** Build a fake Supabase client with chainable query builders. */
function makeFakeDb(existing: Array<{ destination: string; tier: string; slug: string }>): FakeDb {
  const toursInsert = vi.fn()
  const departuresInsert = vi.fn()
  const toursDelete = vi.fn()
  const toursDeleteEq = vi.fn()
  const toursDeleteIn = vi.fn()

  const selectChain = {
    eq: vi.fn().mockResolvedValue({ data: existing, error: null }),
  }

  const deleteChain = {
    eq: toursDeleteEq,
    in: toursDeleteIn,
  }
  toursDeleteEq.mockReturnValue(deleteChain)
  toursDeleteIn.mockResolvedValue({ error: null })

  const toursBuilder = {
    select: vi.fn().mockReturnValue(selectChain),
    insert: toursInsert,
    delete: toursDelete,
  }
  toursDelete.mockReturnValue(deleteChain)

  const departuresBuilder = {
    insert: departuresInsert,
  }

  const db = {
    from: vi.fn((table: string) => (table === 'tour_catalog_tours' ? toursBuilder : departuresBuilder)),
  } as unknown as SupabaseClient

  return { db, toursInsert, departuresInsert, toursDelete, toursDeleteEq, toursDeleteIn }
}

describe('seedCatalog', () => {
  /** A new-shape product: the read-in guard refuses a feed where no tour has content fields. */
  const seedTour = (overrides: Partial<FirstPartyTour> = {}): FirstPartyTour =>
    makeTour({ short_description: 'Ten days around the South Island.', ...overrides })

  it('inserts tours then departures and reports counts', async () => {
    const { db, toursInsert, departuresInsert } = makeFakeDb([])
    toursInsert.mockReturnValue({
      select: vi.fn().mockResolvedValue({
        data: [{ id: 'id-1', destination: 'New Zealand', tier: 'premium', slug: 'south-island' }],
        error: null,
      }),
    })
    departuresInsert.mockResolvedValue({ error: null })

    const result = await seedCatalog(db, 'client-1', makeFeed([seedTour()]))

    expect(result.toursInserted).toBe(1)
    expect(result.departuresInserted).toBe(1)
    expect(result.skippedExisting).toEqual([])
    expect(toursInsert).toHaveBeenCalledTimes(1)
    expect(departuresInsert).toHaveBeenCalledTimes(1)

    const tourRows = toursInsert.mock.calls[0][0] as Array<Record<string, unknown>>
    expect(tourRows[0].client_id).toBe('client-1')
    expect(tourRows[0].sort_order).toBe(0)

    const departureRows = departuresInsert.mock.calls[0][0] as Array<Record<string, unknown>>
    expect(departureRows[0].client_id).toBe('client-1')
    expect(departureRows[0].tour_id).toBe('id-1')
    expect(departureRows[0].status).toBe('open')
    expect(departureRows[0].status_source).toBe('seed')
  })

  it('skips empty insert calls', async () => {
    const { db, toursInsert, departuresInsert } = makeFakeDb([])
    toursInsert.mockReturnValue({
      select: vi.fn().mockResolvedValue({ data: [], error: null }),
    })

    const result = await seedCatalog(db, 'client-1', makeFeed([seedTour({ departure_dates: [] })]))

    expect(result.toursInserted).toBe(1)
    expect(result.departuresInserted).toBe(0)
    expect(departuresInsert).not.toHaveBeenCalled()
  })

  it('refuses to read in when the catalog already has a tour, and writes nothing', async () => {
    const { db, toursInsert, departuresInsert } = makeFakeDb([
      { destination: 'Somewhere', tier: 'other', slug: 'unrelated-tour' },
    ])

    await expect(seedCatalog(db, 'client-1', makeFeed([seedTour()]))).rejects.toThrow('catalog_not_empty')
    expect(toursInsert).not.toHaveBeenCalled()
    expect(departuresInsert).not.toHaveBeenCalled()
  })

  it('refuses an old-shape feed (no tour has a main image or a short description) before touching the database', async () => {
    const { db, toursInsert } = makeFakeDb([])
    const oldShape = makeFeed([makeTour(), makeTour({ slug: 'north-island', hero_image: '', short_description: '  ' })])

    await expect(seedCatalog(db, 'client-1', oldShape)).rejects.toThrow('feed_missing_content_fields')
    expect(db.from).not.toHaveBeenCalled()
    expect(toursInsert).not.toHaveBeenCalled()
  })

  it('reads a feed in when at least one tour carries the content fields', async () => {
    const { db, toursInsert } = makeFakeDb([])
    toursInsert.mockReturnValue({ select: vi.fn().mockResolvedValue({ data: [], error: null }) })
    const mixed = makeFeed([
      makeTour({ departure_dates: [] }),
      makeTour({ slug: 'north-island', departure_dates: [], hero_image: '/images/a.jpg' }),
    ])

    const result = await seedCatalog(db, 'client-1', mixed)
    expect(result.toursInserted).toBe(2)
  })

  it('throws when the tours insert fails', async () => {
    const { db, toursInsert } = makeFakeDb([])
    toursInsert.mockReturnValue({
      select: vi.fn().mockResolvedValue({ data: null, error: { message: 'boom' } }),
    })

    await expect(seedCatalog(db, 'client-1', makeFeed([seedTour()]))).rejects.toThrow('boom')
  })

  it('deletes inserted tours and rethrows when the departures insert fails', async () => {
    const { db, toursInsert, departuresInsert, toursDelete, toursDeleteEq, toursDeleteIn } = makeFakeDb([])
    toursInsert.mockReturnValue({
      select: vi.fn().mockResolvedValue({
        data: [
          { id: 'id-1', destination: 'New Zealand', tier: 'premium', slug: 'south-island' },
          { id: 'id-2', destination: 'New Zealand', tier: 'premium', slug: 'north-island' },
        ],
        error: null,
      }),
    })
    departuresInsert.mockResolvedValue({ error: { message: 'departures_boom' } })

    await expect(
      seedCatalog(db, 'client-1', makeFeed([
        seedTour({ slug: 'south-island' }),
        seedTour({ slug: 'north-island' }),
      ])),
    ).rejects.toThrow('departures_boom')

    expect(toursDelete).toHaveBeenCalledTimes(1)
    expect(toursDeleteEq).toHaveBeenCalledWith('client_id', 'client-1')
    expect(toursDeleteIn).toHaveBeenCalledWith('id', ['id-1', 'id-2'])
  })

  it('still rethrows the original error when the compensation delete fails', async () => {
    const { db, toursInsert, departuresInsert, toursDeleteIn } = makeFakeDb([])
    toursInsert.mockReturnValue({
      select: vi.fn().mockResolvedValue({
        data: [{ id: 'id-1', destination: 'New Zealand', tier: 'premium', slug: 'south-island' }],
        error: null,
      }),
    })
    departuresInsert.mockResolvedValue({ error: { message: 'departures_boom' } })
    toursDeleteIn.mockResolvedValue({ error: { message: 'delete_boom' } })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(seedCatalog(db, 'client-1', makeFeed([seedTour()])))
      .rejects.toThrow('departures_boom')

    expect(consoleError).toHaveBeenCalled()
    consoleError.mockRestore()
  })
})

import { normalizeDomain } from '../seed'

describe('normalizeDomain', () => {
  it('reduces any website form to the bare hostname used by the feed registry', () => {
    expect(normalizeDomain('www.ctstours.co.nz')).toBe('ctstours.co.nz')
    expect(normalizeDomain('https://www.CTStours.co.nz/tours?x=1')).toBe('ctstours.co.nz')
    expect(normalizeDomain('  ctstours.co.nz  ')).toBe('ctstours.co.nz')
    expect(normalizeDomain('http://example.com:8080/a')).toBe('example.com')
  })
})

describe('feedLacksContentFields', () => {
  it('is true only when there are tours and none has a main image or a short description', () => {
    expect(feedLacksContentFields(makeFeed([]))).toBe(false)
    expect(feedLacksContentFields(makeFeed([makeTour(), makeTour()]))).toBe(true)
    expect(feedLacksContentFields(makeFeed([makeTour(), makeTour({ short_description: 'Intro' })]))).toBe(false)
    expect(feedLacksContentFields(makeFeed([makeTour({ hero_image: '/images/a.jpg' })]))).toBe(false)
  })
})
