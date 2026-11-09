import { describe, expect, it } from 'vitest'
import { loadPublishedTourFacts } from '../store-publish'
import {
  CLIENT_ID,
  TODAY,
  asDb,
  departureRow,
  makeFakeDb,
  publishedRow,
  tourRow,
} from './store-publish.fixtures'

async function read(tours: Record<string, unknown>[], departures: Record<string, unknown>[]) {
  const db = makeFakeDb({ published: [publishedRow(7, tours, departures)] })
  const result = await loadPublishedTourFacts(asDb(db), CLIENT_ID, TODAY)
  if (!result.published) throw new Error('expected a published snapshot')
  return { result, db }
}

describe('loadPublishedTourFacts', () => {
  it('returns { published: false } when nothing is published', async () => {
    const db = makeFakeDb({ tours: [tourRow()], published: [] })
    expect(await loadPublishedTourFacts(asDb(db), CLIENT_ID, TODAY)).toEqual({ published: false })
  })

  it('carries the published version, highlights, inclusions and display price', async () => {
    const { result } = await read(
      [tourRow({ highlights: ['Great Wall', 'Terracotta Warriors'], inclusions: ['Hotels'] })],
      [departureRow()],
    )
    expect(result.version).toBe(7)
    expect(result.tours).toHaveLength(1)
    const tour = result.tours[0]
    expect(tour.highlights).toEqual(['Great Wall', 'Terracotta Warriors'])
    expect(tour.inclusions).toEqual(['Hotels'])
    expect(tour.displayPriceText).toBe('From NZD $4,999 per person')
    expect(tour.departures).toEqual([
      { departOn: '2027-03-11', displayDate: '11 March 2027', status: 'open', priceTextOverride: null },
    ])
  })

  it('keeps the whole-tour sold-out flag even when departures are open', async () => {
    const { result } = await read([tourRow({ sold_out: true })], [departureRow()])
    expect(result.tours[0].soldOut).toBe(true)
    expect(result.tours[0].isActive).toBe(true)
  })

  it('drops past, sold_out, closed and cancelled departures but keeps limited ones', async () => {
    const { result } = await read(
      [tourRow()],
      [
        departureRow({ id: 'd-past', depart_on: '2026-10-09' }),
        departureRow({ id: 'd-sold', depart_on: '2027-04-01', status: 'sold_out' }),
        departureRow({ id: 'd-closed', depart_on: '2027-04-02', status: 'closed' }),
        departureRow({ id: 'd-cancelled', depart_on: '2027-04-03', status: 'cancelled' }),
        departureRow({ id: 'd-limited', depart_on: '2027-05-13', status: 'limited' }),
        departureRow({ id: 'd-open', depart_on: '2027-03-11', status: 'open' }),
      ],
    )
    expect(result.tours[0].departures.map((d) => [d.departOn, d.status])).toEqual([
      ['2027-03-11', 'open'],
      ['2027-05-13', 'limited'],
    ])
  })

  it('a departure on exactly today is still visible', async () => {
    const { result } = await read([tourRow()], [departureRow({ depart_on: TODAY })])
    expect(result.tours[0].departures).toHaveLength(1)
  })

  it('a tour that manages departures is inactive when none is visible; one that does not is still active', async () => {
    const { result } = await read(
      [
        tourRow({ id: 't-managed', name: 'Managed', manages_departures: true }),
        tourRow({ id: 't-open', name: 'Open', manages_departures: false }),
        tourRow({ id: 't-off', name: 'Off', manages_departures: false, is_active: false }),
      ],
      [],
    )
    const byName = Object.fromEntries(result.tours.map((t) => [t.name, t.isActive]))
    expect(byName).toEqual({ Managed: false, Open: true, Off: false })
  })

  it('blank price override becomes null; a real override is kept verbatim', async () => {
    const { result } = await read(
      [tourRow()],
      [
        departureRow({ id: 'd1', depart_on: '2027-03-11', price_text_override: '   ' }),
        departureRow({ id: 'd2', depart_on: '2027-05-13', price_text_override: 'NZD $4,380' }),
      ],
    )
    expect(result.tours[0].departures.map((d) => d.priceTextOverride)).toEqual([null, 'NZD $4,380'])
  })

  it('never exposes internal departure data', async () => {
    const { result } = await read(
      [tourRow()],
      [departureRow({ internal: { airline: 'Secret Air', capacity: 25, outboundRoute: 'AKL-PVG' } })],
    )
    const json = JSON.stringify(result)
    expect(json).not.toContain('Secret Air')
    expect(json).not.toContain('capacity')
    expect(json).not.toContain('AKL-PVG')
  })

  it('sorts by sortOrder then name', async () => {
    const { result } = await read(
      [
        tourRow({ id: 'a', name: 'Beta', sort_order: 2 }),
        tourRow({ id: 'b', name: 'Alpha', sort_order: 2 }),
        tourRow({ id: 'c', name: 'Zed', sort_order: 1 }),
      ],
      [],
    )
    expect(result.tours.map((t) => t.name)).toEqual(['Zed', 'Alpha', 'Beta'])
  })

  it('never reads the draft tables', async () => {
    const { db } = await read([tourRow()], [departureRow()])
    expect(db.fromCalls).not.toContain('tour_catalog_tours')
    expect(db.fromCalls).not.toContain('tour_catalog_departures')
  })
})
