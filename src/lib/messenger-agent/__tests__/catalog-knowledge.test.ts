import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { KnowledgeEntry, KnowledgeReadResult } from '@/lib/knowledge'

const mocks = vi.hoisted(() => {
  return {
    getClientKnowledge: vi.fn(),
    supabaseFrom: vi.fn(),
  }
})

vi.mock('@/lib/knowledge', () => ({
  getClientKnowledge: mocks.getClientKnowledge,
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: mocks.supabaseFrom,
  },
}))

import {
  buildCatalogKnowledgeEntries,
  loadCatalogKnowledgeEntries,
  getClientKnowledgeWithCatalog,
  parsePriceNzd,
  nzToday,
  type CatalogTourRow,
  type CatalogDepartureRow,
} from '../catalog-knowledge'

const FIXED_NOW = new Date('2026-10-21T01:00:00Z')

function makeTour(overrides: Partial<CatalogTourRow> = {}): CatalogTourRow {
  return {
    id: 'tour-1',
    slug: 'silk-road',
    destination: 'china',
    tier: 'signature',
    name: 'China Signature Silk Road',
    display_price_text: 'From NZD $3,480 per person',
    is_active: true,
    sold_out: false,
    ...overrides,
  }
}

function makeDeparture(overrides: Partial<CatalogDepartureRow> = {}): CatalogDepartureRow {
  return {
    tour_id: 'tour-1',
    depart_on: '2026-11-01',
    status: 'open',
    price_text_override: null,
    ...overrides,
  }
}

function build(
  tours: CatalogTourRow[],
  departures: CatalogDepartureRow[],
  now: Date = FIXED_NOW,
): KnowledgeEntry[] {
  return buildCatalogKnowledgeEntries({
    clientId: 'client-1',
    tours,
    departures,
    now,
  })
}

function structured(entry: KnowledgeEntry): Record<string, unknown> {
  const v = entry.structuredValue
  if (!v || typeof v !== 'object') throw new Error('structuredValue is not an object')
  return v as Record<string, unknown>
}

// ---------------------------------------------------------------------------
// 1. Departure status / past-date filtering
// ---------------------------------------------------------------------------

describe('buildCatalogKnowledgeEntries — departure filtering', () => {
  it('ignores past-dated departures and closed/cancelled/sold_out statuses', () => {
    const tours = [makeTour()]
    const departures: CatalogDepartureRow[] = [
      makeDeparture({ depart_on: '2026-10-01', status: 'open' }), // past
      makeDeparture({ depart_on: '2026-11-01', status: 'closed' }),
      makeDeparture({ depart_on: '2026-11-02', status: 'cancelled' }),
      makeDeparture({ depart_on: '2026-11-03', status: 'sold_out' }),
    ]
    expect(build(tours, departures)).toEqual([])
  })

  it('includes open and limited departures', () => {
    const tours = [makeTour()]
    const departures: CatalogDepartureRow[] = [
      makeDeparture({ depart_on: '2026-11-01', status: 'open' }),
      makeDeparture({ depart_on: '2026-11-02', status: 'limited' }),
    ]
    const entries = build(tours, departures)
    expect(entries).toHaveLength(1)
    expect(structured(entries[0]).departure_dates).toEqual(['2026-11-01', '2026-11-02'])
  })
})

// ---------------------------------------------------------------------------
// 2. NZ-date cutoff
// ---------------------------------------------------------------------------

describe('buildCatalogKnowledgeEntries — Pacific/Auckland date cutoff', () => {
  it('treats 2026-10-20T12:30:00Z as 2026-10-21 in Auckland (NZDT)', () => {
    const now = new Date('2026-10-20T12:30:00Z')
    expect(nzToday(now)).toBe('2026-10-21')

    const tours = [makeTour()]
    const departures: CatalogDepartureRow[] = [
      makeDeparture({ depart_on: '2026-10-20', status: 'open' }),
      makeDeparture({ depart_on: '2026-10-21', status: 'open' }),
    ]
    const entries = build(tours, departures, now)
    expect(entries).toHaveLength(1)
    expect(structured(entries[0]).departure_dates).toEqual(['2026-10-21'])
  })

  it('treats 2026-10-20T10:30:00Z as still 2026-10-20 in Auckland', () => {
    const now = new Date('2026-10-20T10:30:00Z')
    expect(nzToday(now)).toBe('2026-10-20')

    const tours = [makeTour()]
    const departures: CatalogDepartureRow[] = [
      makeDeparture({ depart_on: '2026-10-20', status: 'open' }),
    ]
    const entries = build(tours, departures, now)
    expect(entries).toHaveLength(1)
    expect(structured(entries[0]).departure_dates).toEqual(['2026-10-20'])
  })
})

// ---------------------------------------------------------------------------
// 3. parsePriceNzd
// ---------------------------------------------------------------------------

describe('parsePriceNzd', () => {
  it('parses plain NZD amounts', () => {
    expect(parsePriceNzd('NZD $3,480')).toBe(3480)
  })

  it('parses "From NZD $X per person"', () => {
    expect(parsePriceNzd('From NZD $4,080 per person')).toBe(4080)
  })

  it('returns null for unknown / empty / unparseable text', () => {
    expect(parsePriceNzd('TBC')).toBeNull()
    expect(parsePriceNzd('From NZD $TBC per person')).toBeNull()
    expect(parsePriceNzd('')).toBeNull()
    expect(parsePriceNzd(null)).toBeNull()
    expect(parsePriceNzd('call us')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 4. Inactive / sold-out tours
// ---------------------------------------------------------------------------

describe('buildCatalogKnowledgeEntries — tour eligibility', () => {
  it('produces no entries for inactive or sold-out tours', () => {
    const tours = [
      makeTour({ id: 'tour-inactive', is_active: false }),
      makeTour({ id: 'tour-soldout', sold_out: true }),
    ]
    const departures: CatalogDepartureRow[] = [
      makeDeparture({ tour_id: 'tour-inactive', depart_on: '2026-11-01' }),
      makeDeparture({ tour_id: 'tour-soldout', depart_on: '2026-11-01' }),
    ]
    expect(build(tours, departures)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// 5. Price override → separate entry
// ---------------------------------------------------------------------------

describe('buildCatalogKnowledgeEntries — price overrides', () => {
  it('splits departures by price and keeps factKeys unique', () => {
    const tours = [makeTour()]
    const departures: CatalogDepartureRow[] = [
      makeDeparture({ depart_on: '2026-11-01', price_text_override: null }),
      makeDeparture({ depart_on: '2026-11-02', price_text_override: null }),
      makeDeparture({
        depart_on: '2026-11-15',
        price_text_override: 'NZD $4,080 per person',
      }),
    ]
    const entries = build(tours, departures)
    expect(entries).toHaveLength(2)

    const byPrice = new Map<number, KnowledgeEntry>()
    for (const e of entries) {
      const price = structured(e).price_nzd
      expect(typeof price).toBe('number')
      byPrice.set(price as number, e)
    }

    const base = byPrice.get(3480)
    const override = byPrice.get(4080)
    expect(base).toBeDefined()
    expect(override).toBeDefined()

    expect(structured(base as KnowledgeEntry).departure_dates).toEqual([
      '2026-11-01',
      '2026-11-02',
    ])
    expect(structured(override as KnowledgeEntry).departure_dates).toEqual(['2026-11-15'])

    const factKeys = entries.map((e) => e.factKey)
    expect(new Set(factKeys).size).toBe(factKeys.length)

    const names = new Set(entries.map((e) => structured(e).name))
    const codes = new Set(entries.map((e) => structured(e).code))
    expect(names.size).toBe(1)
    expect(codes.size).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// 6. Entry shape / no availability leakage
// ---------------------------------------------------------------------------

describe('buildCatalogKnowledgeEntries — entry shape', () => {
  it('produces approved, customer-ok, price-sensitive entries with the expected structuredValue', () => {
    const entries = build(
      [makeTour()],
      [makeDeparture({ depart_on: '2026-11-01', status: 'open' })],
    )
    expect(entries).toHaveLength(1)
    const entry = entries[0]

    expect(entry.sensitivity).toBe('price')
    expect(entry.status).toBe('approved')
    expect(entry.visibility).toBe('customer_ok')
    expect(entry.clientConfirmedByEmail).toBeNull()
    expect(entry.clientConfirmedAt).toBeNull()
    expect(entry.approvedByEmail).toBeNull()

    const sv = structured(entry)
    expect(typeof sv.code).toBe('string')
    expect(typeof sv.price_nzd).toBe('number')
    expect(Array.isArray(sv.departure_dates)).toBe(true)
    expect(typeof sv.itinerary_url).toBe('string')
  })

  it('never mentions availability / remaining seats', () => {
    const entries = build(
      [makeTour()],
      [
        makeDeparture({ depart_on: '2026-11-01', status: 'open' }),
        makeDeparture({ depart_on: '2026-11-02', status: 'limited' }),
      ],
    )
    const forbidden = /seat|remaining|places left|名额|余位|仅剩/i
    for (const entry of entries) {
      expect(entry.statement).not.toMatch(forbidden)
      expect(JSON.stringify(entry.structuredValue)).not.toMatch(forbidden)
    }
  })
})

// ---------------------------------------------------------------------------
// 7. loadCatalogKnowledgeEntries — error propagation
// ---------------------------------------------------------------------------

interface FakeQuery {
  select: () => FakeQuery
  eq: () => FakeQuery
  gte: () => Promise<{ data: null; error: { message: string } }>
}

function makeErrorDb(): SupabaseClient {
  const query: FakeQuery = {
    select: () => query,
    eq: () => query,
    gte: () => Promise.resolve({ data: null, error: { message: 'boom' } }),
  }
  const db = {
    from: () => query,
  }
  return db as unknown as SupabaseClient
}

describe('loadCatalogKnowledgeEntries', () => {
  it('throws when a query returns an error', async () => {
    await expect(
      loadCatalogKnowledgeEntries(makeErrorDb(), 'client-1', FIXED_NOW),
    ).rejects.toThrow(/boom/)
  })
})

// ---------------------------------------------------------------------------
// 8. getClientKnowledgeWithCatalog
// ---------------------------------------------------------------------------

function makeBaseEntry(): KnowledgeEntry {
  return {
    id: 'base-1',
    clientId: 'client-1',
    factKey: 'company.hours',
    scope: {},
    statement: 'Office hours are 9-5.',
    structuredValue: null,
    conflictGroupId: null,
    status: 'approved',
    visibility: 'customer_ok',
    sensitivity: 'general',
    validFrom: '2026-01-01T00:00:00Z',
    validUntil: null,
    lastVerifiedAt: null,
    approvedByEmail: null,
    approvedAt: null,
    clientConfirmedByEmail: null,
    clientConfirmedAt: null,
  }
}

interface CatalogQueryResult {
  data: unknown
  error: { message: string } | null
}

interface CatalogQuery {
  select: () => CatalogQuery
  eq: () => CatalogQuery
  gte: () => Promise<CatalogQueryResult>
}

function makeCatalogDb(tours: CatalogTourRow[], departures: CatalogDepartureRow[]): SupabaseClient {
  const builderFor = (rows: unknown[]) => {
    const q: Record<string, unknown> = {}
    q.select = () => q
    q.eq = () => q
    q.gte = () => q
    // Awaiting the chain resolves like a Supabase query: { data, error }.
    q.then = (resolve: (v: { data: unknown[]; error: null }) => unknown) => resolve({ data: rows, error: null })
    return q
  }
  const db = {
    from: (table: string) => builderFor(table === 'tour_catalog_tours' ? tours : departures),
  }
  return db as unknown as SupabaseClient
}

describe('getClientKnowledgeWithCatalog', () => {
  beforeEach(() => {
    mocks.getClientKnowledge.mockReset()
    mocks.supabaseFrom.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns base unchanged for internal_brief and never touches supabase', async () => {
    const baseEntry = makeBaseEntry()
    const base: KnowledgeReadResult = { entries: [baseEntry], forbiddenFactKeys: [] }
    mocks.getClientKnowledge.mockResolvedValue(base)

    const result = await getClientKnowledgeWithCatalog('client-1', { purpose: 'internal_brief' })

    expect(result).toBe(base)
    expect(mocks.supabaseFrom).not.toHaveBeenCalled()
  })

  it('returns base unchanged when the catalog read throws (customer_reply)', async () => {
    const baseEntry = makeBaseEntry()
    const base: KnowledgeReadResult = { entries: [baseEntry], forbiddenFactKeys: [] }
    mocks.getClientKnowledge.mockResolvedValue(base)

    const failingQuery: CatalogQuery = {
      select: () => failingQuery,
      eq: () => failingQuery,
      gte: () => Promise.resolve({ data: null, error: { message: 'boom' } }),
    }
    mocks.supabaseFrom.mockReturnValue(failingQuery)

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const result = await getClientKnowledgeWithCatalog('client-1', { purpose: 'customer_reply' })

    expect(result).toBe(base)
    expect(warnSpy).toHaveBeenCalled()
  })

  it('appends catalog entries to base entries (customer_reply)', async () => {
    const baseEntry = makeBaseEntry()
    const base: KnowledgeReadResult = { entries: [baseEntry], forbiddenFactKeys: [] }
    mocks.getClientKnowledge.mockResolvedValue(base)

    const tours = [makeTour()]
    const departures = [makeDeparture({ depart_on: '2026-11-01', status: 'open' })]
    const catalogDb = makeCatalogDb(tours, departures)
    mocks.supabaseFrom.mockImplementation((table: string) => (catalogDb as unknown as { from: (t: string) => unknown }).from(table))

    const result = await getClientKnowledgeWithCatalog('client-1', { purpose: 'customer_reply' })

    expect(result.entries.length).toBe(2)
    expect(result.entries[0]).toBe(baseEntry)
    expect(result.entries[1].factKey.startsWith('tour.active.')).toBe(true)
    expect(result.forbiddenFactKeys).toEqual([])
  })

  it('drops catalog entries when the retired key carries only the short tour slug', async () => {
    mocks.getClientKnowledge.mockResolvedValue({ entries: [], forbiddenFactKeys: ['tour.retired.silk-road'] })
    const catalogDb = makeCatalogDb([makeTour()], [makeDeparture({ depart_on: '2026-11-01', status: 'open' })])
    mocks.supabaseFrom.mockImplementation((table: string) => (catalogDb as unknown as { from: (t: string) => unknown }).from(table))

    const result = await getClientKnowledgeWithCatalog('client-1', { purpose: 'customer_reply' })

    expect(result.entries).toEqual([])
  })

  it('drops catalog entries whose code appears in forbiddenFactKeys', async () => {
    const baseEntry = makeBaseEntry()
    const base: KnowledgeReadResult = {
      entries: [baseEntry],
      forbiddenFactKeys: ['tour.retired.china-signature-silk-road'],
    }
    mocks.getClientKnowledge.mockResolvedValue(base)

    const tours = [makeTour()]
    const departures = [makeDeparture({ depart_on: '2026-11-01', status: 'open' })]
    const catalogDb = makeCatalogDb(tours, departures)
    mocks.supabaseFrom.mockImplementation((table: string) => (catalogDb as unknown as { from: (t: string) => unknown }).from(table))

    const result = await getClientKnowledgeWithCatalog('client-1', { purpose: 'customer_reply' })

    expect(result.entries).toEqual([baseEntry])
    expect(result.forbiddenFactKeys).toEqual(['tour.retired.china-signature-silk-road'])
  })

  it('propagates a rejection from getClientKnowledge', async () => {
    mocks.getClientKnowledge.mockRejectedValue(new Error('base read failed'))

    await expect(
      getClientKnowledgeWithCatalog('client-1', { purpose: 'customer_reply' }),
    ).rejects.toThrow(/base read failed/)
  })
})
