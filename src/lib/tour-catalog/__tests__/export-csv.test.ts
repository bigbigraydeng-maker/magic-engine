import { describe, expect, it } from 'vitest'
import { csvCell, toursToCsv } from '../export-csv'
import type { CatalogDeparture, CatalogTour } from '../types'

function makeTour(overrides: Partial<CatalogTour> = {}): CatalogTour {
  return {
    id: 'tour-1',
    clientId: 'client-1',
    slug: 'grand-tour',
    destination: '日本',
    tier: 'premium',
    name: '经典日本',
    title: null,
    shortDescription: null,
    durationText: null,
    displayPriceText: null,
    highlights: [],
    itinerary: [],
    inclusions: [],
    exclusions: [],
    tourCities: [],
    singleSupplement: null,
    maxGroupSize: null,
    isActive: true,
    managesDepartures: true,
    sortOrder: 0,
    updatedAt: '2026-01-01T00:00:00.000Z',
    heroImage: null,
    gallery: [],
    metaTitle: null,
    metaDescription: null,
    tags: [],
    faqs: [],
    soldOut: false,
    singleSupplementNote: null,
    rating: null,
    reviewCount: null,
    reviewSummary: null,
    quickAnswer: null,
    siteExtras: {},
    ...overrides,
  }
}

function makeDeparture(overrides: Partial<CatalogDeparture> = {}): CatalogDeparture {
  return {
    id: 'dep-1',
    tourId: 'tour-1',
    clientId: 'client-1',
    departOn: '2026-06-01',
    returnOn: null,
    priceTextOverride: null,
    status: 'open',
    internal: {},
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

const BOM = '\uFEFF'

function rows(csv: string): string[] {
  return csv.split('\r\n')
}

describe('toursToCsv', () => {
  it('starts with a BOM, has 30 header columns and one row per tour', () => {
    const csv = toursToCsv([makeTour(), makeTour({ id: 'tour-2' })], [], '2026-01-01')
    expect(csv.startsWith(BOM)).toBe(true)
    const lines = rows(csv)
    expect(lines[0].split(',').length).toBe(30)
    expect(lines.length).toBe(1 + 2 + 1)
    expect(lines[lines.length - 1]).toBe('')
  })

  it('guards formula prefixes and escapes commas and quotes', () => {
    const formula = toursToCsv([makeTour({ name: '=HYPERLINK("x")' })], [], '2026-01-01')
    expect(formula).toContain("'=HYPERLINK")
    const quoted = toursToCsv([makeTour({ name: 'a,b"c' })], [], '2026-01-01')
    expect(quoted).toContain('"a,b""c"')
  })

  it('never outputs departure internal fields', () => {
    const departure = makeDeparture({ internal: { airline: 'SECRET-AIR', capacity: 42 } })
    const csv = toursToCsv([makeTour()], [departure], '2026-01-01')
    expect(csv).not.toContain('SECRET-AIR')
    expect(csv).not.toContain('42')
  })

  it('picks the next bookable departure and sorts all departures with labels', () => {
    const departures = [
      makeDeparture({ id: 'd1', departOn: '2025-01-01', status: 'open' }),
      makeDeparture({ id: 'd2', departOn: '2026-07-01', status: 'cancelled' }),
      makeDeparture({ id: 'd3', departOn: '2026-08-01', status: 'closed' }),
      makeDeparture({ id: 'd4', departOn: '2026-09-01', status: 'limited' }),
      makeDeparture({ id: 'd5', departOn: '2026-05-01', status: 'open' }),
    ]
    const csv = toursToCsv([makeTour()], departures, '2026-01-01')
    const cells = rows(csv)[1].split(',')
    expect(cells[14]).toBe('2026-05-01')
    expect(cells[15]).toBe(
      '2025-01-01 可订；2026-05-01 可订；2026-07-01 已取消；2026-08-01 已关闭；2026-09-01 少量余位',
    )
  })

  it('renders empty arrays and nulls as empty cells without null or undefined text', () => {
    const csv = toursToCsv([makeTour()], [], '2026-01-01')
    const cells = rows(csv)[1].split(',')
    expect(cells[1]).toBe('')
    expect(cells[5]).toBe('')
    expect(cells[9]).toBe('')
    expect(cells[14]).toBe('')
    expect(cells[15]).toBe('')
    expect(cells[17]).toBe('')
    expect(cells[21]).toBe('')
    expect(cells[26]).toBe('')
    expect(csv).not.toContain('null')
    expect(csv).not.toContain('undefined')
  })

  it('keeps Chinese text and semicolon joins unchanged', () => {
    const tour = makeTour({
      name: '日本深度游',
      highlights: ['富士山', '京都'],
      inclusions: ['机票', '酒店'],
    })
    const csv = toursToCsv([tour], [], '2026-01-01')
    const cells = rows(csv)[1].split(',')
    expect(cells[0]).toBe('日本深度游')
    expect(cells[17]).toBe('富士山；京都')
    expect(cells[18]).toBe('机票；酒店')
  })
})

describe('csvCell', () => {
  it('prefixes a single quote for formula prefixes', () => {
    expect(csvCell('=1+1')).toBe("'=1+1")
    expect(csvCell('@cmd')).toBe("'@cmd")
  })

  it('wraps and doubles when the cell contains special characters', () => {
    expect(csvCell('a,b')).toBe('"a,b"')
    expect(csvCell('a"b')).toBe('"a""b"')
    expect(csvCell('plain')).toBe('plain')
  })
})

describe('toursToCsv review fixes', () => {
  const base = {
    id: 'd1', tourId: 't1', clientId: 'c', returnOn: null, priceTextOverride: null,
    internal: {}, updatedAt: '2026-01-01T00:00:00Z',
  }
  it('counts only bookable future departures and shows the update date without time', () => {
    const tour = makeTour({ id: 't1', updatedAt: '2026-10-10T13:30:12.044498+00:00' })
    const deps = [
      { ...base, id: 'a', departOn: '2099-01-01', status: 'cancelled' as const },
      { ...base, id: 'b', departOn: '2099-02-01', status: 'open' as const },
    ]
    const line = toursToCsv([tour], deps, '2026-10-11').split('\r\n')[1]
    const cells = line.split(',')
    expect(cells).toContain('2026-10-10')
    expect(line).not.toContain('T13:30')
    expect(cells[12]).toBe('2')
    expect(cells[13]).toBe('1')
  })
})
