/**
 * Putting the per-day extras back into an itinerary the AI assistant proposed. Pure, no I/O.
 *
 * The model returns a whole itinerary but usually leaves out each day's accommodation, festive
 * label and operator logo; without this step every assistant edit of an itinerary would wipe them
 * (design §6.11.1 item 2). They used to be put back by day NUMBER, which hands every hotel to the
 * wrong day as soon as a day is inserted or removed. Now a proposed day finds "its" stored day:
 *
 *   1. by title — identical after trimming; several days with the same title pair up in order;
 *   2. failing that, by day number — only when the number of days is unchanged, and only with a
 *      stored day that no title has claimed;
 *   3. failing that, it inherits nothing, and the day is reported so the person applying the
 *      proposal is told to check those days.
 *
 * What the proposal says itself always wins for accommodation and festive label. The operator
 * logo is never the model's to set: it only ever comes from the matched stored day.
 */

import type { CatalogItineraryDay } from './types'

export interface MergedItinerary {
  /** The proposed itinerary with the extras put back; not an array → returned as it came. */
  itinerary: unknown
  /** Day numbers that found no stored day to inherit from, ascending. Empty when nothing could be lost. */
  unmatchedDays: number[]
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExtras(day: CatalogItineraryDay): boolean {
  return day.accommodation !== undefined || day.festiveLabel !== undefined || day.operatorLogo !== undefined
}

function titleOf(item: unknown): string | null {
  return isPlainObject(item) && typeof item.title === 'string' ? item.title.trim() : null
}

/** Step 1: each proposed day takes the first still-unclaimed stored day with the same title. */
function matchByTitle(current: readonly CatalogItineraryDay[], proposed: readonly unknown[]): Array<number | null> {
  const queues = new Map<string, number[]>()
  current.forEach((day, index) => {
    const title = day.title.trim()
    const queue = queues.get(title)
    if (queue === undefined) queues.set(title, [index])
    else queue.push(index)
  })
  return proposed.map((item) => {
    const title = titleOf(item)
    const next = title === null ? undefined : queues.get(title)?.shift()
    return next === undefined ? null : next
  })
}

/** Step 2: with the same number of days, an unmatched day falls back to its own day number. */
function matchByDayNumber(
  current: readonly CatalogItineraryDay[],
  proposed: readonly unknown[],
  matches: Array<number | null>,
): void {
  if (proposed.length !== current.length) return
  const claimed = new Set(matches.filter((index): index is number => index !== null))
  proposed.forEach((item, position) => {
    if (matches[position] !== null || !isPlainObject(item) || typeof item.day !== 'number') return
    const index = current.findIndex((day) => day.day === item.day)
    if (index < 0 || claimed.has(index)) return
    matches[position] = index
    claimed.add(index)
  })
}

function mergeDay(proposed: Record<string, unknown>, stored: CatalogItineraryDay | undefined): Record<string, unknown> {
  const { operatorLogo: _ignored, ...day } = proposed
  if (!('accommodation' in day) && stored?.accommodation !== undefined) day.accommodation = stored.accommodation
  if (!('festiveLabel' in day) && stored?.festiveLabel !== undefined) day.festiveLabel = stored.festiveLabel
  // The logo is never the model's to set: whatever it sent is dropped and the stored one is kept.
  return stored?.operatorLogo === undefined ? day : { ...day, operatorLogo: stored.operatorLogo }
}

export function mergeItineraryExtras(current: readonly CatalogItineraryDay[], proposed: unknown): MergedItinerary {
  if (!Array.isArray(proposed)) return { itinerary: proposed, unmatchedDays: [] }
  const items: unknown[] = proposed
  const matches = matchByTitle(current, items)
  matchByDayNumber(current, items, matches)
  // Nothing stored to inherit means nothing can be lost: no point in warning about any day.
  const somethingToLose = current.some(hasExtras)
  const unmatchedDays: number[] = []
  const itinerary = items.map((item, position) => {
    if (!isPlainObject(item)) return item
    const index = matches[position]
    if (index === null && somethingToLose) {
      unmatchedDays.push(typeof item.day === 'number' ? item.day : position + 1)
    }
    return mergeDay(item, index === null ? undefined : current[index])
  })
  unmatchedDays.sort((a, b) => a - b)
  return { itinerary, unmatchedDays }
}
