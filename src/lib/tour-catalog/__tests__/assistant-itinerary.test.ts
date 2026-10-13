import { describe, expect, it } from 'vitest'
import { checkProposal, type ProposalCheck } from '../assistant'
import { mergeItineraryExtras } from '../assistant-itinerary'
import type { CatalogSnapshot } from '../store'
import type { CatalogItineraryDay } from '../types'
import { blankTour } from './content-fixture'

const LOGO = { src: '/images/air.png', alt: 'Sample Air' }

/** An 18-day itinerary: a hotel on every night but the last, a festival on day 9, the logo on day 1. */
function eighteenDays(): CatalogItineraryDay[] {
  return Array.from({ length: 18 }, (_, index) => {
    const number = index + 1
    const day: CatalogItineraryDay = { day: number, title: `City ${number}`, description: `Plan ${number}` }
    if (number < 18) day.accommodation = `Hotel ${number}`
    if (number === 9) day.festiveLabel = 'Lantern Festival'
    if (number === 1) day.operatorLogo = LOGO
    return day
  })
}

/** What the model sends back: the same days without any of the extras. */
function bare(days: readonly CatalogItineraryDay[]): Array<Record<string, unknown>> {
  return days.map((day) => ({ day: day.day, title: day.title, description: day.description }))
}

function renumber(days: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return days.map((day, index) => ({ ...day, day: index + 1 }))
}

function merged(current: readonly CatalogItineraryDay[], proposed: unknown): { days: CatalogItineraryDay[]; unmatchedDays: number[] } {
  const result = mergeItineraryExtras(current, proposed)
  return { days: result.itinerary as CatalogItineraryDay[], unmatchedDays: result.unmatchedDays }
}

function hotelByTitle(days: readonly CatalogItineraryDay[]): Record<string, string | undefined> {
  return Object.fromEntries(days.map((day) => [day.title, day.accommodation]))
}

function check(current: CatalogItineraryDay[], itinerary: unknown): { check: ProposalCheck; days: CatalogItineraryDay[] | undefined } {
  const snapshot: CatalogSnapshot = { tours: [blankTour({ id: 'tour-1', itinerary: current })], departures: [], aliases: [] }
  const result = checkProposal(snapshot, { kind: 'update_tour', tourId: 'tour-1', summary: 's', patch: { itinerary } })
  if (result === null || result.proposal.kind !== 'update_tour') throw new Error('unexpected proposal')
  return { check: result.check, days: result.proposal.patch.itinerary }
}

describe('mergeItineraryExtras follows the day, not the day number', () => {
  const current = eighteenDays()
  const before = hotelByTitle(current)

  it('inserting a day before day 2: every hotel stays with its own day, the new day has none', () => {
    const proposed = bare(current)
    proposed.splice(1, 0, { day: 0, title: 'Extra stop', description: 'New' })
    const { days, unmatchedDays } = merged(current, renumber(proposed))
    expect(days.length).toBe(19)
    expect(days[1].title).toBe('Extra stop')
    expect('accommodation' in days[1]).toBe(false)
    expect('festiveLabel' in days[1]).toBe(false)
    expect('operatorLogo' in days[1]).toBe(false)
    const after = hotelByTitle(days)
    for (const day of current) expect(after[day.title], day.title).toBe(before[day.title])
    expect(days[2].accommodation).toBe('Hotel 2')
    expect(days[9].festiveLabel).toBe('Lantern Festival')
    expect(days[8].festiveLabel).toBeUndefined()
    expect(days[0].operatorLogo).toEqual(LOGO)
    expect(days.filter((day) => day.operatorLogo !== undefined).length).toBe(1)
    expect(unmatchedDays).toEqual([2])
  })

  it('deleting a day in the middle: the other days keep their own hotels, nothing is unmatched', () => {
    const proposed = bare(current)
    proposed.splice(6, 1)
    const { days, unmatchedDays } = merged(current, renumber(proposed))
    expect(days.length).toBe(17)
    const after = hotelByTitle(days)
    for (const day of current) {
      if (day.day !== 7) expect(after[day.title], day.title).toBe(before[day.title])
    }
    expect(days[6].title).toBe('City 8')
    expect(days[6].accommodation).toBe('Hotel 8')
    expect(days[7].festiveLabel).toBe('Lantern Festival')
    expect(unmatchedDays).toEqual([])
  })

  it('changing only a description keeps every hotel, the festival and the logo', () => {
    const proposed = bare(current)
    proposed[4] = { ...proposed[4], description: 'Rewritten' }
    const { days, unmatchedDays } = merged(current, proposed)
    expect(days.map((day) => day.accommodation)).toEqual(current.map((day) => day.accommodation))
    expect(days[8].festiveLabel).toBe('Lantern Festival')
    expect(days[0].operatorLogo).toEqual(LOGO)
    expect(days[4].description).toBe('Rewritten')
    expect(unmatchedDays).toEqual([])
  })

  it('a changed title with the same number of days falls back to the day number', () => {
    const proposed = bare(current)
    proposed[4] = { ...proposed[4], title: 'Renamed city' }
    proposed[0] = { ...proposed[0], title: 'Renamed arrival' }
    const { days, unmatchedDays } = merged(current, proposed)
    expect(days[4].accommodation).toBe('Hotel 5')
    expect(days[0].accommodation).toBe('Hotel 1')
    expect(days[0].operatorLogo).toEqual(LOGO)
    expect(unmatchedDays).toEqual([])
  })

  it('swapping two days: the hotels travel with their titles', () => {
    const proposed = bare(current)
    const third = proposed[2]
    proposed[2] = proposed[3]
    proposed[3] = third
    const { days, unmatchedDays } = merged(current, renumber(proposed))
    expect(days[2].title).toBe('City 4')
    expect(days[2].accommodation).toBe('Hotel 4')
    expect(days[3].title).toBe('City 3')
    expect(days[3].accommodation).toBe('Hotel 3')
    expect(unmatchedDays).toEqual([])
  })

  it('a day-number fallback never takes a stored day that a title already claimed', () => {
    // Days 3 and 4 swap places AND the day that used to be 4 is renamed: its number-3 fallback
    // would be the stored day 3, which "City 3" has claimed by title — so it inherits nothing.
    const proposed = bare(current)
    proposed[2] = { ...proposed[3], title: 'Renamed city' }
    proposed[3] = bare(current)[2]
    const { days, unmatchedDays } = merged(current, renumber(proposed))
    expect(days[3].accommodation).toBe('Hotel 3')
    expect('accommodation' in days[2]).toBe(false)
    expect(unmatchedDays).toEqual([3])
  })

  it('what the proposal says itself wins, also on a day that matches nothing', () => {
    const proposed = bare(current)
    proposed[2] = { ...proposed[2], accommodation: 'Another hotel' }
    proposed[8] = { ...proposed[8], festiveLabel: '' }
    proposed.splice(1, 0, { day: 0, title: 'Extra stop', description: 'New', accommodation: 'Brand new hotel' })
    const { days } = merged(current, renumber(proposed))
    expect(days[1].accommodation).toBe('Brand new hotel')
    expect(days[3].accommodation).toBe('Another hotel')
    expect(days[9].festiveLabel).toBe('')
  })

  it('never takes a logo from the proposal: matched day → the stored one, no match → none', () => {
    const proposed = bare(current)
    proposed[0] = { ...proposed[0], operatorLogo: { src: '/images/other.png', alt: 'Other' } }
    proposed.splice(1, 0, { day: 0, title: 'Extra stop', description: 'New', operatorLogo: { src: '/images/other.png', alt: 'Other' } })
    const { days } = merged(current, renumber(proposed))
    expect(days[0].operatorLogo).toEqual(LOGO)
    expect('operatorLogo' in days[1]).toBe(false)
  })

  it('days with the same title pair up in order', () => {
    const repeated: CatalogItineraryDay[] = [
      { day: 1, title: 'Beijing', description: 'a', accommodation: 'Hotel A' },
      { day: 2, title: 'Beijing', description: 'b', accommodation: 'Hotel B' },
      { day: 3, title: 'Xi\'an', description: 'c', accommodation: 'Hotel C' },
    ]
    const proposed = [
      { day: 1, title: 'Prologue', description: 'new' },
      { day: 2, title: ' Beijing ', description: 'a' },
      { day: 3, title: 'Beijing', description: 'b' },
      { day: 4, title: 'Beijing', description: 'one more' },
      { day: 5, title: 'Xi\'an', description: 'c' },
    ]
    const { days, unmatchedDays } = merged(repeated, proposed)
    expect(days.map((day) => day.accommodation)).toEqual([undefined, 'Hotel A', 'Hotel B', undefined, 'Hotel C'])
    expect(unmatchedDays).toEqual([1, 4])
  })

  it('reports nothing when the stored itinerary has no extras to lose', () => {
    const plain = bare(current) as unknown as CatalogItineraryDay[]
    const proposed = bare(current)
    proposed.splice(1, 0, { day: 0, title: 'Extra stop', description: 'New' })
    expect(merged(plain, renumber(proposed)).unmatchedDays).toEqual([])
  })
})

describe('checkProposal with a re-shaped itinerary', () => {
  it('warns about the day that could not inherit when a day is inserted', () => {
    const current = eighteenDays()
    const proposed = bare(current)
    proposed.splice(1, 0, { day: 0, title: 'Extra stop', description: 'New' })
    const result = check(current, renumber(proposed))
    // 'itinerary_mostly_changed' still compares titles by day number, so an insertion trips it too
    // (existing behaviour, not changed here); the new warning names the day to check.
    expect(result.check).toEqual({
      ok: true,
      warnings: [
        { code: 'itinerary_mostly_changed', changed: 17, total: 18 },
        { code: 'itinerary_extras_unmatched', days: [2] },
      ],
    })
    expect(result.days?.length).toBe(19)
    expect(result.days?.[1].accommodation).toBeUndefined()
    expect(result.days?.[2].accommodation).toBe('Hotel 2')
    expect(result.days?.[18].title).toBe('City 18')
    expect(result.days?.[0].operatorLogo).toEqual(LOGO)
  })

  it('adds the warning next to the shrink warning when both apply', () => {
    const current = eighteenDays()
    const proposed = bare(current).slice(0, 10)
    proposed[4] = { ...proposed[4], title: 'Renamed city' }
    const result = check(current, proposed)
    expect(result.check).toEqual({
      ok: true,
      warnings: [
        { code: 'itinerary_shrinks', from: 18, to: 10 },
        { code: 'itinerary_extras_unmatched', days: [5] },
      ],
    })
    expect(result.days?.[4].accommodation).toBeUndefined()
    expect(result.days?.[5].accommodation).toBe('Hotel 6')
  })

  it('gives no warning for a plain description edit', () => {
    const current = eighteenDays()
    const proposed = bare(current)
    proposed[4] = { ...proposed[4], description: 'Rewritten' }
    const result = check(current, proposed)
    expect(result.check).toEqual({ ok: true })
    expect(result.days?.map((day) => day.accommodation)).toEqual(current.map((day) => day.accommodation))
  })

  it('still refuses when the logo would end up on another day number (inserting before the logo day)', () => {
    const current = eighteenDays()
    const proposed = bare(current)
    proposed.splice(0, 0, { day: 0, title: 'Departure eve', description: 'New' })
    expect(check(current, renumber(proposed)).check).toEqual({ ok: false, errors: [{ field: '*', code: 'forbidden' }] })
  })
})
