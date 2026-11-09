import type { BookingOptionTour } from './booking-options'
import type { OverviewEmptyDeparture } from './booking-overview-types'

export const EMPTY_DEPARTURE_HORIZON_MONTHS = 12

/** Add whole months to an ISO date (YYYY-MM-DD), clamping the day to the last day of the target month (2028-02-29 + 12 months = 2029-02-28). String in, string out. Use Date.UTC arithmetic only on the parsed numbers. */
export function addMonthsClamped(iso: string, months: number): string {
  const y = Number(iso.slice(0, 4))
  const m = Number(iso.slice(5, 7))
  const d = Number(iso.slice(8, 10))

  const total = y * 12 + (m - 1) + months
  const ny = Math.floor(total / 12)
  const nm = (total % 12) + 1
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate()
  const nd = Math.min(d, last)

  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${String(ny).padStart(4, '0')}-${pad(nm)}-${pad(nd)}`
}

/** Departures worth showing as empty rows: bookable status only ('open' or 'limited', same whitelist as the catalog plan), departOn (first 10 chars) between today and today+horizon inclusive, de-duplicated by tourId+departOn (keep the first), sorted by departOn then tourName. */
export function emptyDeparturesFor(
  options: BookingOptionTour[],
  today: string,
  horizonMonths: number = EMPTY_DEPARTURE_HORIZON_MONTHS,
): OverviewEmptyDeparture[] {
  const horizon = addMonthsClamped(today, horizonMonths)
  const seen = new Set<string>()
  const result: OverviewEmptyDeparture[] = []

  for (const tour of options) {
    for (const departure of tour.departures) {
      if (departure.status !== 'open' && departure.status !== 'limited') continue

      const departOn = departure.departOn.slice(0, 10)
      if (departOn < today || departOn > horizon) continue

      const dedupeKey = `${tour.id}\u0000${departOn}`
      if (seen.has(dedupeKey)) continue
      seen.add(dedupeKey)

      result.push({
        departureId: departure.id,
        tourId: tour.id,
        tourName: tour.name,
        departOn,
      })
    }
  }

  result.sort((a, b) => {
    if (a.departOn < b.departOn) return -1
    if (a.departOn > b.departOn) return 1
    const an = a.tourName ?? ''
    const bn = b.tourName ?? ''
    if (an < bn) return -1
    if (an > bn) return 1
    return 0
  })

  return result
}
