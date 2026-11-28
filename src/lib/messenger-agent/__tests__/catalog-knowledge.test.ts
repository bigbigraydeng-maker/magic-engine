import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { KnowledgeEntry, KnowledgeReadResult } from '@/lib/knowledge'
import type { FirstPartyTour } from '@/lib/web-intelligence/first-party-tours'

const mocks = vi.hoisted(() => {
  return {
    getClientKnowledge: vi.fn(),
    loadPublishedProducts: vi.fn(),
  }
})

vi.mock('@/lib/knowledge', () => ({
  getClientKnowledge: mocks.getClientKnowledge,
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { __opaque: 'supabaseAdmin' },
}))

vi.mock('@/lib/tour-catalog/store-publish', () => ({
  loadPublishedProducts: mocks.loadPublishedProducts,
}))

import {
  buildCatalogKnowledgeEntries,
  loadCatalogKnowledgeEntries,
  getClientKnowledgeWithCatalog,
  parseDisplayDate,
  parsePriceNzd,
  nzToday,
} from '../catalog-knowledge'

const FIXED_NOW = new Date('2026-10-21T01:00:00Z')

function makeTour(overrides: Partial<FirstPartyTour> = {}): FirstPartyTour {
  return {
    id: 'tour-1',
    slug: 'silk-road',
    destination: 'china',
    tier: 'signature',
    name: 'China Signature Silk Road',
    price: 'From NZD $3,480 per person',
    is_active: true,
    updated_at: '2026-10-19',
    departure_dates: [],
    departure_pricing: {},
    tour_cities: [],
    itinerary: [],
    inclusions: [],
    exclusions: [],
    ...overrides,
  }
}

function build(tours: FirstPartyTour[], now: Date = FIXED_NOW): KnowledgeEntry[] {
  return buildCatalogKnowledgeEntries({ clientId: 'client-1', tours, now })
}

function structured(entry: KnowledgeEntry): Record<string, unknown> {
  const v = entry.structuredValue
  if (!v || typeof v !== 'object') throw new Error('structuredValue is not an object')
  return v as Record<string, unknown>
}

// ---------------------------------------------------------------------------
// 1. parseDisplayDate
// ---------------------------------------------------------------------------

describe('parseDisplayDate', () => {
  it('parses "D Month YYYY" into ISO', () => {
    expect(parseDisplayDate('13 May 2027')).toBe('2027-05-13')
    expect(parseDisplayDate('1 January 2027')).toBe('2027-01-01')
  })

  it('returns null for impossible or non-matching dates', () => {
    expect(parseDisplayDate('31 February 2027')).toBeNull()
    expect(parseDisplayDate('May 13 2027')).toBeNull()
    expect(parseDisplayDate('2027-05-13')).toBeNull()
    expect(parseDisplayDate('13 Foo 2027')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 2. NZ-date cutoff
// ---------------------------------------------------------------------------

describe('buildCatalogKnowledgeEntries — Pacific/Auckland date cutoff', () => {
  it('treats 2026-10-20T12:30:00Z as 2026-10-21 in Auckland (NZDT)', () => {
    const now = new Date('2026-10-20T12:30:00Z')
    expect(nzToday(now)).toBe('2026-10-21')

    const tours = [
      makeTour({
        departure_dates: ['20 October 2026', '21 October 2026'],
      }),
    ]
    const entries = build(tours, now)
    expect(entries).toHaveLength(1)
    expect(structured(entries[0]).departure_dates).toEqual(['2026-10-21'])
  })

  it('excludes past dates and includes today (NZ) at the fixed now', () => {
    const tours = [
      makeTour({
        departure_dates: ['20 October 2026', '21 October 2026', '22 October 2026'],
      }),
    ]
    const entries = build(tours)
    expect(entries).toHaveLength(1)
    expect(structured(entries[0]).departure_dates).toEqual(['2026-10-21', '2026-10-22'])
  })
})

// ---------------------------------------------------------------------------
// 3. Inactive / sold-out tours
// ---------------------------------------------------------------------------

describe('alias from the short tour name', () => {
  it('"China Signature — Silk Road" gets alias "Silk Road"; a name without a dash gets none', () => {
    const entries = buildCatalogKnowledgeEntries({
      clientId: 'client-1',
      tours: [
        makeTour({ id: 't1', name: 'China Signature — Silk Road', departure_dates: ['1 November 2026'] }),
        makeTour({ id: 't2', slug: 'plain', name: 'Plain Name', departure_dates: ['1 November 2026'] }),
      ],
      now: new Date('2026-10-21T01:00:00Z'),
    })
    const aliasesOf = (n: string) =>
      (entries.find((e) => (e.structuredValue as { name: string }).name === n)!.structuredValue as { aliases: string[] }).aliases
    expect(aliasesOf('China Signature — Silk Road')).toEqual(['Silk Road'])
    expect(aliasesOf('Plain Name')).toEqual([])
  })
})

describe('buildCatalogKnowledgeEntries — tour eligibility', () => {
  it('produces no entries for inactive or sold-out tours', () => {
    const tours = [
      makeTour({
        id: 'tour-inactive',
        slug: 'inactive',
        is_active: false,
        departure_dates: ['1 November 2026'],
      }),
      makeTour({
        id: 'tour-soldout',
        slug: 'soldout',
        sold_out: true,
        departure_dates: ['1 November 2026'],
      }),
    ]
    expect(build(tours)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// 4. Price overrides → separate entries
// ---------------------------------------------------------------------------

describe('buildCatalogKnowledgeEntries — price overrides', () => {
  it('splits departures by price and keeps factKeys unique', () => {
    const tours = [
      makeTour({
        departure_dates: ['1 November 2026', '2 November 2026', '15 November 2026'],
        departure_pricing: {
          '15 November 2026': 'NZD $4,080 per person',
        },
      }),
    ]
    const entries = build(tours)
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

  it('skips dates whose price text is unparsable (no fallback to the tour price)', () => {
    const tours = [
      makeTour({
        departure_dates: ['1 November 2026', '2 November 2026'],
        departure_pricing: {
          '2 November 2026': 'From NZD $TBC per person',
        },
      }),
    ]
    const entries = build(tours)
    expect(entries).toHaveLength(1)
    expect(structured(entries[0]).price_nzd).toBe(3480)
    expect(structured(entries[0]).departure_dates).toEqual(['2026-11-01'])
  })

  it('skips dates whose override is a per-couple price', () => {
    const tours = [
      makeTour({
        departure_dates: ['1 November 2026', '2 November 2026'],
        departure_pricing: {
          '2 November 2026': 'NZD $900 per couple',
        },
      }),
    ]
    const entries = build(tours)
    expect(entries).toHaveLength(1)
    expect(structured(entries[0]).departure_dates).toEqual(['2026-11-01'])
  })
})

// ---------------------------------------------------------------------------
// 5. Entry shape / no availability leakage
// ---------------------------------------------------------------------------

describe('buildCatalogKnowledgeEntries — entry shape', () => {
  it('produces approved, customer-ok, price-sensitive entries with the expected structuredValue', () => {
    const entries = build([makeTour({ departure_dates: ['1 November 2026'] })])
    expect(entries).toHaveLength(1)
    const entry = entries[0]

    expect(entry.sensitivity).toBe('price')
    expect(entry.status).toBe('approved')
    expect(entry.visibility).toBe('customer_ok')
    expect(entry.clientConfirmedByEmail).toBeNull()
    expect(entry.clientConfirmedAt).toBeNull()
    expect(entry.approvedByEmail).toBeNull()
    expect(entry.approvedAt).toBeNull()

    const sv = structured(entry)
    expect(sv.code).toBe('china-signature-silk-road')
    expect(sv.name).toBe('China Signature Silk Road')
    expect(typeof sv.price_nzd).toBe('number')
    expect(Array.isArray(sv.departure_dates)).toBe(true)
    expect(typeof sv.itinerary_url).toBe('string')
  })

  it('never mentions availability / remaining seats', () => {
    const entries = build([
      makeTour({ departure_dates: ['1 November 2026', '2 November 2026'] }),
    ])
    const forbidden = /seat|remaining|places left|名额|余位|仅剩/i
    for (const entry of entries) {
      expect(entry.statement).not.toMatch(forbidden)
      expect(JSON.stringify(entry.structuredValue)).not.toMatch(forbidden)
    }
  })
})

// ---------------------------------------------------------------------------
// 6. parsePriceNzd
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
    // 🔴 Only plain per-person amounts are trusted (the entry states "per person").
    expect(parsePriceNzd('NZD $900 per couple')).toBeNull()
    expect(parsePriceNzd('Was NZD $4,000 now NZD $3,480')).toBeNull()
    expect(parsePriceNzd('NZD $3,480 - $3,680')).toBeNull()
    expect(parsePriceNzd('NZD $3,480.50')).toBeNull()
    expect(parsePriceNzd('NZD $0')).toBeNull()
    expect(parsePriceNzd('NZD $12')).toBeNull()
    expect(parsePriceNzd('AUD $3,480')).toBeNull()
    expect(parsePriceNzd('NZD $3,480 (dates TBC)')).toBeNull()
    expect(parsePriceNzd('  from nzd $4,080  ')).toBe(4080)
  })
})

// ---------------------------------------------------------------------------
// 7. loadCatalogKnowledgeEntries
// ---------------------------------------------------------------------------

describe('loadCatalogKnowledgeEntries', () => {
  beforeEach(() => {
    mocks.loadPublishedProducts.mockReset()
  })

  it('calls loadPublishedProducts with (db, clientId, NZ-today)', async () => {
    const db = { __opaque: 'db' } as unknown as SupabaseClient
    mocks.loadPublishedProducts.mockResolvedValue({ published: false, tours: [] })

    await loadCatalogKnowledgeEntries(db, 'client-1', FIXED_NOW)

    expect(mocks.loadPublishedProducts).toHaveBeenCalledTimes(1)
    expect(mocks.loadPublishedProducts).toHaveBeenCalledWith(db, 'client-1', '2026-10-21')
  })

  it('returns [] when the catalog is not published', async () => {
    const db = { __opaque: 'db' } as unknown as SupabaseClient
    mocks.loadPublishedProducts.mockResolvedValue({ published: false, tours: [] })

    const entries = await loadCatalogKnowledgeEntries(db, 'client-1', FIXED_NOW)
    expect(entries).toEqual([])
  })

  it('builds entries from the published tours', async () => {
    const db = { __opaque: 'db' } as unknown as SupabaseClient
    mocks.loadPublishedProducts.mockResolvedValue({
      published: true,
      tours: [makeTour({ departure_dates: ['1 November 2026'] })],
    })

    const entries = await loadCatalogKnowledgeEntries(db, 'client-1', FIXED_NOW)
    expect(entries).toHaveLength(1)
    expect(entries[0].factKey.startsWith('tour.active.')).toBe(true)
  })

  it('rejects when loadPublishedProducts rejects', async () => {
    const db = { __opaque: 'db' } as unknown as SupabaseClient
    mocks.loadPublishedProducts.mockRejectedValue(new Error('boom'))

    await expect(loadCatalogKnowledgeEntries(db, 'client-1', FIXED_NOW)).rejects.toThrow(/boom/)
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

describe('getClientKnowledgeWithCatalog', () => {
  beforeEach(() => {
    mocks.getClientKnowledge.mockReset()
    mocks.loadPublishedProducts.mockReset()
    // The wrapper reads the real clock; pin it so the fixtures' dates never go stale (no time bomb).
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-21T01:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('returns base unchanged for internal_brief and never reads the catalog', async () => {
    const baseEntry = makeBaseEntry()
    const base: KnowledgeReadResult = { entries: [baseEntry], forbiddenFactKeys: [] }
    mocks.getClientKnowledge.mockResolvedValue(base)

    const result = await getClientKnowledgeWithCatalog('client-1', { purpose: 'internal_brief' })

    expect(result).toBe(base)
    expect(mocks.loadPublishedProducts).not.toHaveBeenCalled()
  })

  it('returns base unchanged when the catalog read throws (customer_reply)', async () => {
    const baseEntry = makeBaseEntry()
    const base: KnowledgeReadResult = { entries: [baseEntry], forbiddenFactKeys: [] }
    mocks.getClientKnowledge.mockResolvedValue(base)
    mocks.loadPublishedProducts.mockRejectedValue(new Error('boom'))

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const result = await getClientKnowledgeWithCatalog('client-1', { purpose: 'customer_reply' })

    expect(result).toBe(base)
    expect(warnSpy).toHaveBeenCalled()
  })

  it('appends catalog entries to base entries (customer_reply)', async () => {
    const baseEntry = makeBaseEntry()
    const base: KnowledgeReadResult = { entries: [baseEntry], forbiddenFactKeys: [] }
    mocks.getClientKnowledge.mockResolvedValue(base)
    mocks.loadPublishedProducts.mockResolvedValue({
      published: true,
      tours: [makeTour({ departure_dates: ['1 November 2026'] })],
    })

    const result = await getClientKnowledgeWithCatalog('client-1', { purpose: 'customer_reply' })

    expect(result.entries.length).toBe(2)
    expect(result.entries[0]).toBe(baseEntry)
    expect(result.entries[1].factKey.startsWith('tour.active.')).toBe(true)
    expect(result.forbiddenFactKeys).toEqual([])
    // 🔴 隔离：两层都必须用调用方给的 clientId（把包装层改传别家 id 这里会红）
    expect(mocks.getClientKnowledge).toHaveBeenCalledWith('client-1', { purpose: 'customer_reply' })
    expect(mocks.loadPublishedProducts).toHaveBeenCalledWith({ __opaque: 'supabaseAdmin' }, 'client-1', '2026-10-21')
    expect(result.entries[1].clientId).toBe('client-1')
  })

  it('passes the base forbiddenFactKeys through untouched', async () => {
    mocks.getClientKnowledge.mockResolvedValue({ entries: [], forbiddenFactKeys: ['tour.retired.some-other-tour'] })
    mocks.loadPublishedProducts.mockResolvedValue({
      published: true,
      tours: [makeTour({ departure_dates: ['1 November 2026'] })],
    })

    const result = await getClientKnowledgeWithCatalog('client-1', { purpose: 'customer_reply' })

    expect(result.forbiddenFactKeys).toEqual(['tour.retired.some-other-tour'])
    expect(result.entries).toHaveLength(1)
  })

  it('drops catalog entries for a retired key that uses the .alias. convention', async () => {
    mocks.getClientKnowledge.mockResolvedValue({
      entries: [],
      forbiddenFactKeys: ['tour.retired.old-name.alias.silk-road'],
    })
    mocks.loadPublishedProducts.mockResolvedValue({
      published: true,
      tours: [makeTour({ departure_dates: ['1 November 2026'] })],
    })

    const result = await getClientKnowledgeWithCatalog('client-1', { purpose: 'customer_reply' })

    expect(result.entries).toEqual([])
  })

  it('drops catalog entries when the retired key carries only the short tour slug', async () => {
    mocks.getClientKnowledge.mockResolvedValue({
      entries: [],
      forbiddenFactKeys: ['tour.retired.silk-road'],
    })
    mocks.loadPublishedProducts.mockResolvedValue({
      published: true,
      tours: [makeTour({ departure_dates: ['1 November 2026'] })],
    })

    const result = await getClientKnowledgeWithCatalog('client-1', { purpose: 'customer_reply' })

    expect(result.entries).toEqual([])
  })

  it('propagates a rejection from getClientKnowledge', async () => {
    mocks.getClientKnowledge.mockRejectedValue(new Error('base read failed'))

    await expect(
      getClientKnowledgeWithCatalog('client-1', { purpose: 'customer_reply' }),
    ).rejects.toThrow(/base read failed/)
  })

  it('returns base unchanged when the catalog is not published', async () => {
    const baseEntry = makeBaseEntry()
    const base: KnowledgeReadResult = { entries: [baseEntry], forbiddenFactKeys: [] }
    mocks.getClientKnowledge.mockResolvedValue(base)
    mocks.loadPublishedProducts.mockResolvedValue({ published: false, tours: [] })

    const result = await getClientKnowledgeWithCatalog('client-1', { purpose: 'customer_reply' })

    expect(result.entries).toEqual([baseEntry])
    expect(result.forbiddenFactKeys).toEqual([])
  })
})

describe('接线：起草读资料和 customer-facing 工具都走带团目录的包装函数', () => {
  it('🔴 conversation-inbound-draft-store 和 tools.ts 的 query_customer_facing_facts 用 getClientKnowledgeWithCatalog（漏接类型检查抓不到）', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8')
    const store = read('src/lib/inngest/functions/conversation-inbound-draft-store.ts')
    const tools = read('src/lib/messenger-agent/tools.ts')
    expect(store).toMatch(/getClientKnowledgeWithCatalog\(clientId, \{ purpose: 'customer_reply' \}\)/)
    expect(tools).toMatch(/const result = await getClientKnowledgeWithCatalog\(ctx\.clientId, \{ purpose: 'customer_reply' \}\)/)
  })
})
