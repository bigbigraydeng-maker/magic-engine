import { describe, it, expect } from 'vitest'
import { planDepartureImport } from '../plan'
import type { PlanInput } from '../plan'
import type { ParsedDepartureRow } from '../departures-csv'
import type {
  CatalogAlias,
  CatalogDeparture,
  CatalogDepartureInternal,
  CatalogTour,
  DepartureStatus,
} from '../types'
import { EMPTY_TOUR_CONTENT } from './content-fixture'

function makeTour(overrides: Partial<CatalogTour> & { id: string; name: string }): CatalogTour {
  return {
    clientId: 'c1',
    slug: overrides.id,
    destination: 'China',
    tier: 'standard',
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
    ...EMPTY_TOUR_CONTENT,
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

function makeDeparture(
  overrides: Partial<CatalogDeparture> & { id: string; tourId: string; departOn: string },
): CatalogDeparture {
  return {
    clientId: 'c1',
    returnOn: null,
    priceTextOverride: null,
    status: 'open',
    internal: {},
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

function makeRow(
  overrides: Partial<ParsedDepartureRow> & { line: number; tourName: string; departOn: string },
): ParsedDepartureRow {
  return {
    returnOn: overrides.departOn,
    status: null,
    internal: {},
    ...overrides,
  }
}

const TODAY = '2027-01-01'

function baseInput(overrides: Partial<PlanInput>): PlanInput {
  return {
    rows: [],
    tours: [],
    aliases: [],
    existing: [],
    today: TODAY,
    ...overrides,
  }
}

describe('planDepartureImport', () => {
  it('adds a new departure with default status open', () => {
    const tour = makeTour({ id: 't1', name: 'Grand China' })
    const row = makeRow({
      line: 2,
      tourName: 'Grand China',
      departOn: '2027-06-01',
      returnOn: '2027-06-10',
    })
    const plan = planDepartureImport(baseInput({ rows: [row], tours: [tour] }))

    expect(plan.adds).toHaveLength(1)
    expect(plan.adds[0]).toEqual({
      line: 2,
      tourId: 't1',
      departOn: '2027-06-01',
      returnOn: '2027-06-10',
      status: 'open',
      internal: {},
    })
    expect(plan.updates).toHaveLength(0)
    expect(plan.unchangedCount).toBe(0)
    expect(plan.rejected).toHaveLength(0)
  })

  it('updates an existing departure when returnOn changes', () => {
    const tour = makeTour({ id: 't1', name: 'Grand China' })
    const existing = makeDeparture({
      id: 'd1',
      tourId: 't1',
      departOn: '2027-06-01',
      returnOn: '2027-06-10',
    })
    const row = makeRow({
      line: 2,
      tourName: 'Grand China',
      departOn: '2027-06-01',
      returnOn: '2027-06-12',
    })
    const plan = planDepartureImport(
      baseInput({ rows: [row], tours: [tour], existing: [existing] }),
    )

    expect(plan.adds).toHaveLength(0)
    expect(plan.updates).toHaveLength(1)
    expect(plan.updates[0].departureId).toBe('d1')
    expect(plan.updates[0].before).toBe(existing)
    expect(plan.updates[0].after.returnOn).toBe('2027-06-12')
    expect(plan.updates[0].after.status).toBe('open')
  })

  it('counts an unchanged row when nothing differs', () => {
    const tour = makeTour({ id: 't1', name: 'Grand China' })
    const existing = makeDeparture({
      id: 'd1',
      tourId: 't1',
      departOn: '2027-06-01',
      returnOn: '2027-06-10',
      status: 'open',
      internal: {},
    })
    const row = makeRow({
      line: 2,
      tourName: 'Grand China',
      departOn: '2027-06-01',
      returnOn: '2027-06-10',
    })
    const plan = planDepartureImport(
      baseInput({ rows: [row], tours: [tour], existing: [existing] }),
    )

    expect(plan.adds).toHaveLength(0)
    expect(plan.updates).toHaveLength(0)
    expect(plan.unchangedCount).toBe(1)
  })

  it('rejects a row whose tour is not found', () => {
    const tour = makeTour({ id: 't1', name: 'Grand China' })
    const row = makeRow({
      line: 5,
      tourName: 'Unknown Tour',
      departOn: '2027-06-01',
      returnOn: '2027-06-10',
    })
    const plan = planDepartureImport(baseInput({ rows: [row], tours: [tour] }))

    expect(plan.adds).toHaveLength(0)
    expect(plan.rejected).toEqual([
      { line: 5, reason: 'tour_not_found', detail: 'Unknown Tour' },
    ])
  })

  it('rejects an ambiguous tour with candidate names joined by pipe', () => {
    const t1 = makeTour({ id: 't1', name: 'Natural China' })
    const t2 = makeTour({ id: 't2', name: 'Natural China' })
    const row = makeRow({
      line: 3,
      tourName: 'Natural China',
      departOn: '2027-06-01',
      returnOn: '2027-06-10',
    })
    const plan = planDepartureImport(baseInput({ rows: [row], tours: [t1, t2] }))

    expect(plan.adds).toHaveLength(0)
    expect(plan.rejected).toHaveLength(1)
    expect(plan.rejected[0].reason).toBe('tour_ambiguous')
    expect(plan.rejected[0].detail).toBe('Natural China | Natural China')
  })

  it('rejects every copy of conflicting duplicate rows', () => {
    const tour = makeTour({ id: 't1', name: 'Grand China' })
    const rowA = makeRow({
      line: 2,
      tourName: 'Grand China',
      departOn: '2027-06-01',
      returnOn: '2027-06-10',
    })
    const rowB = makeRow({
      line: 3,
      tourName: 'Grand China',
      departOn: '2027-06-01',
      returnOn: '2027-06-15',
    })
    const plan = planDepartureImport(baseInput({ rows: [rowA, rowB], tours: [tour] }))

    expect(plan.adds).toHaveLength(0)
    expect(plan.rejected).toHaveLength(2)
    expect(plan.rejected.every((r) => r.reason === 'conflicting_duplicate_rows')).toBe(true)
    expect(plan.rejected.map((r) => r.line).sort()).toEqual([2, 3])
  })

  it('collapses identical duplicates into a single add (first line wins)', () => {
    const tour = makeTour({ id: 't1', name: 'Grand China' })
    const rowA = makeRow({
      line: 2,
      tourName: 'Grand China',
      departOn: '2027-06-01',
      returnOn: '2027-06-10',
    })
    const rowB = makeRow({
      line: 3,
      tourName: 'Grand China',
      departOn: '2027-06-01',
      returnOn: '2027-06-10',
    })
    const plan = planDepartureImport(baseInput({ rows: [rowA, rowB], tours: [tour] }))

    expect(plan.adds).toHaveLength(1)
    expect(plan.adds[0].line).toBe(2)
    expect(plan.rejected).toHaveLength(0)
  })

  it('applies CSV status when present and keeps existing status when absent', () => {
    const tour = makeTour({ id: 't1', name: 'Grand China' })
    const existing = makeDeparture({
      id: 'd1',
      tourId: 't1',
      departOn: '2027-06-01',
      returnOn: '2027-06-10',
      status: 'limited',
    })
    const rowWithStatus = makeRow({
      line: 2,
      tourName: 'Grand China',
      departOn: '2027-06-01',
      returnOn: '2027-06-10',
      status: 'sold_out',
    })
    const planWith = planDepartureImport(
      baseInput({ rows: [rowWithStatus], tours: [tour], existing: [existing] }),
    )
    expect(planWith.updates).toHaveLength(1)
    expect(planWith.updates[0].after.status).toBe('sold_out')

    const rowWithoutStatus = makeRow({
      line: 2,
      tourName: 'Grand China',
      departOn: '2027-06-01',
      returnOn: '2027-06-11',
      status: null,
    })
    const planWithout = planDepartureImport(
      baseInput({ rows: [rowWithoutStatus], tours: [tour], existing: [existing] }),
    )
    expect(planWithout.updates).toHaveLength(1)
    expect(planWithout.updates[0].after.status).toBe('limited')
  })

  it('merges internal, keeping existing airline when row only changes capacity', () => {
    const tour = makeTour({ id: 't1', name: 'Grand China' })
    const existing = makeDeparture({
      id: 'd1',
      tourId: 't1',
      departOn: '2027-06-01',
      returnOn: '2027-06-10',
      internal: { airline: 'Air NZ', capacity: 20 },
    })
    const row = makeRow({
      line: 2,
      tourName: 'Grand China',
      departOn: '2027-06-01',
      returnOn: '2027-06-10',
      internal: { capacity: 30 },
    })
    const plan = planDepartureImport(
      baseInput({ rows: [row], tours: [tour], existing: [existing] }),
    )

    expect(plan.updates).toHaveLength(1)
    expect(plan.updates[0].after.internal).toEqual({ airline: 'Air NZ', capacity: 30 })
  })

  it('warns not_in_file for a future open departure absent from the file', () => {
    const tour = makeTour({ id: 't1', name: 'Grand China' })
    const present = makeDeparture({
      id: 'd1',
      tourId: 't1',
      departOn: '2027-06-01',
      status: 'open',
    })
    const missing = makeDeparture({
      id: 'd2',
      tourId: 't1',
      departOn: '2027-07-01',
      status: 'open',
    })
    const row = makeRow({
      line: 2,
      tourName: 'Grand China',
      departOn: '2027-06-01',
      returnOn: '2027-06-10',
    })
    const plan = planDepartureImport(
      baseInput({ rows: [row], tours: [tour], existing: [present, missing] }),
    )

    const notInFile = plan.warnings.filter((w) => w.kind === 'not_in_file')
    expect(notInFile).toEqual([
      { kind: 'not_in_file', tourId: 't1', departureId: 'd2', departOn: '2027-07-01' },
    ])
  })

  it('does not warn not_in_file for past, sold_out, or absent tours', () => {
    const tour = makeTour({ id: 't1', name: 'Grand China' })
    const otherTour = makeTour({ id: 't2', name: 'Other Tour' })
    const past = makeDeparture({
      id: 'd1',
      tourId: 't1',
      departOn: '2026-12-01',
      status: 'open',
    })
    const soldOut = makeDeparture({
      id: 'd2',
      tourId: 't1',
      departOn: '2027-08-01',
      status: 'sold_out',
    })
    const otherTourDep = makeDeparture({
      id: 'd3',
      tourId: 't2',
      departOn: '2027-09-01',
      status: 'open',
    })
    const row = makeRow({
      line: 2,
      tourName: 'Grand China',
      departOn: '2027-06-01',
      returnOn: '2027-06-10',
    })
    const plan = planDepartureImport(
      baseInput({
        rows: [row],
        tours: [tour, otherTour],
        existing: [past, soldOut, otherTourDep],
      }),
    )

    expect(plan.warnings.filter((w) => w.kind === 'not_in_file')).toHaveLength(0)
  })

  it('does not warn suspected_typo when the gap is 18 days', () => {
    const tour = makeTour({ id: 't1', name: 'Grand China' })
    const existing = makeDeparture({
      id: 'd1',
      tourId: 't1',
      departOn: '2027-05-13',
      status: 'open',
    })
    const row = makeRow({
      line: 2,
      tourName: 'Grand China',
      departOn: '2027-05-31',
      returnOn: '2027-06-10',
    })
    const plan = planDepartureImport(
      baseInput({ rows: [row], tours: [tour], existing: [existing] }),
    )

    expect(plan.warnings.filter((w) => w.kind === 'suspected_typo')).toHaveLength(0)
  })

  it('warns suspected_typo when the gap is 2 days', () => {
    const tour = makeTour({ id: 't1', name: 'Grand China' })
    const existing = makeDeparture({
      id: 'd1',
      tourId: 't1',
      departOn: '2027-05-13',
      status: 'open',
    })
    const row = makeRow({
      line: 2,
      tourName: 'Grand China',
      departOn: '2027-05-15',
      returnOn: '2027-05-25',
    })
    const plan = planDepartureImport(
      baseInput({ rows: [row], tours: [tour], existing: [existing] }),
    )

    const typos = plan.warnings.filter((w) => w.kind === 'suspected_typo')
    expect(typos).toEqual([
      {
        kind: 'suspected_typo',
        tourId: 't1',
        newDate: '2027-05-15',
        nearDate: '2027-05-13',
        days: 2,
      },
    ])
  })

  it('does not warn suspected_typo for a cancelled near-date departure', () => {
    const tour = makeTour({ id: 't1', name: 'Grand China' })
    const existing = makeDeparture({
      id: 'd1',
      tourId: 't1',
      departOn: '2027-05-13',
      status: 'cancelled',
    })
    const row = makeRow({
      line: 2,
      tourName: 'Grand China',
      departOn: '2027-05-15',
      returnOn: '2027-05-25',
    })
    const plan = planDepartureImport(
      baseInput({ rows: [row], tours: [tour], existing: [existing] }),
    )

    expect(plan.warnings.filter((w) => w.kind === 'suspected_typo')).toHaveLength(0)
  })

  it('never produces a deletes key', () => {
    const tour = makeTour({ id: 't1', name: 'Grand China' })
    const existing = makeDeparture({
      id: 'd1',
      tourId: 't1',
      departOn: '2027-07-01',
      status: 'open',
    })
    const row = makeRow({
      line: 2,
      tourName: 'Grand China',
      departOn: '2027-06-01',
      returnOn: '2027-06-10',
    })
    const plan = planDepartureImport(
      baseInput({ rows: [row], tours: [tour], existing: [existing] }),
    )

    expect('deletes' in plan).toBe(false)
    expect(Object.keys(plan).sort()).toEqual(
      ['adds', 'rejected', 'unchangedCount', 'updates', 'warnings'].sort(),
    )
  })

  it('keeps cancelled status and warns cancelled_kept when CSV has no status', () => {
    const tour = makeTour({ id: 't1', name: 'Grand China' })
    const existing = makeDeparture({
      id: 'd1',
      tourId: 't1',
      departOn: '2027-06-01',
      returnOn: '2027-06-10',
      status: 'cancelled',
    })
    const row = makeRow({
      line: 2,
      tourName: 'Grand China',
      departOn: '2027-06-01',
      returnOn: '2027-06-10',
      status: null,
    })
    const plan = planDepartureImport(
      baseInput({ rows: [row], tours: [tour], existing: [existing] }),
    )

    expect(plan.updates).toHaveLength(0)
    expect(plan.unchangedCount).toBe(1)
    expect(plan.warnings.filter((w) => w.kind === 'cancelled_kept')).toEqual([
      { kind: 'cancelled_kept', tourId: 't1', departureId: 'd1', departOn: '2027-06-01' },
    ])
  })

  it('keeps cancelled status, updates returnOn, and warns cancelled_kept when CSV has no status', () => {
    const tour = makeTour({ id: 't1', name: 'Grand China' })
    const existing = makeDeparture({
      id: 'd1',
      tourId: 't1',
      departOn: '2027-06-01',
      returnOn: '2027-06-10',
      status: 'cancelled',
    })
    const row = makeRow({
      line: 2,
      tourName: 'Grand China',
      departOn: '2027-06-01',
      returnOn: '2027-06-12',
      status: null,
    })
    const plan = planDepartureImport(
      baseInput({ rows: [row], tours: [tour], existing: [existing] }),
    )

    expect(plan.updates).toHaveLength(1)
    expect(plan.updates[0].after.status).toBe('cancelled')
    expect(plan.updates[0].after.returnOn).toBe('2027-06-12')
    expect(plan.warnings.filter((w) => w.kind === 'cancelled_kept')).toEqual([
      { kind: 'cancelled_kept', tourId: 't1', departureId: 'd1', departOn: '2027-06-01' },
    ])
  })

  it('reopens a cancelled departure and warns reopens_cancelled when CSV sets status open', () => {
    const tour = makeTour({ id: 't1', name: 'Grand China' })
    const existing = makeDeparture({
      id: 'd1',
      tourId: 't1',
      departOn: '2027-06-01',
      returnOn: '2027-06-10',
      status: 'cancelled',
    })
    const row = makeRow({
      line: 2,
      tourName: 'Grand China',
      departOn: '2027-06-01',
      returnOn: '2027-06-10',
      status: 'open',
    })
    const plan = planDepartureImport(
      baseInput({ rows: [row], tours: [tour], existing: [existing] }),
    )

    expect(plan.updates).toHaveLength(1)
    expect(plan.updates[0].after.status).toBe('open')
    expect(plan.warnings.filter((w) => w.kind === 'reopens_cancelled')).toEqual([
      {
        kind: 'reopens_cancelled',
        tourId: 't1',
        departureId: 'd1',
        departOn: '2027-06-01',
        newStatus: 'open',
      },
    ])
  })

  it('does not warn cancelled_kept or reopens_cancelled for non-cancelled departures', () => {
    const tour = makeTour({ id: 't1', name: 'Grand China' })
    const existing = makeDeparture({
      id: 'd1',
      tourId: 't1',
      departOn: '2027-06-01',
      returnOn: '2027-06-10',
      status: 'open',
    })
    const row = makeRow({
      line: 2,
      tourName: 'Grand China',
      departOn: '2027-06-01',
      returnOn: '2027-06-12',
      status: null,
    })
    const plan = planDepartureImport(
      baseInput({ rows: [row], tours: [tour], existing: [existing] }),
    )

    expect(plan.warnings.filter((w) => w.kind === 'cancelled_kept')).toHaveLength(0)
    expect(plan.warnings.filter((w) => w.kind === 'reopens_cancelled')).toHaveLength(0)
  })
})
