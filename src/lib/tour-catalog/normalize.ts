/**
 * Tour name normalization and matching.
 * Design: docs/specs/2026-10-09-cts-tour-catalog-in-me-design-v0.3.md
 *
 * Pure functions only: no I/O, no network, no clock access.
 */

import type { CatalogAlias, CatalogTour } from './types'

/** Separator between a long catalog name and its short display name. */
const SHORT_NAME_SEPARATOR = ' — '

/**
 * Normalize a string for comparison: trim, lowercase, turn "&" into " and ",
 * collapse all whitespace runs to a single space, trim again.
 */
export function norm(input: string): string {
  return input
    .replace(/&/g, ' and ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Return the part after the first " — " separator, trimmed.
 * When no separator is present, return the trimmed name unchanged.
 */
export function shortName(name: string): string {
  const index = name.indexOf(SHORT_NAME_SEPARATOR)
  if (index === -1) {
    return name.trim()
  }
  return name.slice(index + SHORT_NAME_SEPARATOR.length).trim()
}

export type MatchResult =
  | { status: 'matched'; tour: CatalogTour }
  | { status: 'none' }
  | { status: 'ambiguous'; candidates: CatalogTour[] }

/** Collect distinct tours (by id) preserving first-seen order. */
function distinctById(tours: CatalogTour[]): CatalogTour[] {
  const seen = new Set<string>()
  const result: CatalogTour[] = []
  for (const tour of tours) {
    if (!seen.has(tour.id)) {
      seen.add(tour.id)
      result.push(tour)
    }
  }
  return result
}

/** Step 1: alias lookup, ignoring aliases whose tour is not in the catalog. */
function matchByAlias(
  rawNorm: string,
  tours: CatalogTour[],
  aliases: CatalogAlias[],
): CatalogTour[] {
  const byId = new Map(tours.map((tour) => [tour.id, tour]))
  const hits: CatalogTour[] = []
  for (const alias of aliases) {
    if (alias.aliasNorm !== rawNorm) {
      continue
    }
    const tour = byId.get(alias.tourId)
    if (tour !== undefined) {
      hits.push(tour)
    }
  }
  return distinctById(hits)
}

/** Step 2: exact match on full name or title. */
function matchByFullName(rawNorm: string, tours: CatalogTour[]): CatalogTour[] {
  const hits = tours.filter(
    (tour) =>
      norm(tour.name) === rawNorm ||
      (tour.title !== null && norm(tour.title) === rawNorm),
  )
  return distinctById(hits)
}

/** Step 3: exact match on short name or short title. */
function matchByShortName(rawNorm: string, tours: CatalogTour[]): CatalogTour[] {
  const hits = tours.filter(
    (tour) =>
      norm(shortName(tour.name)) === rawNorm ||
      (tour.title !== null && norm(shortName(tour.title)) === rawNorm),
  )
  return distinctById(hits)
}

/** Resolve a step's hits into a MatchResult, or null to continue to the next step. */
function resolveStep(hits: CatalogTour[]): MatchResult | null {
  if (hits.length === 1) {
    return { status: 'matched', tour: hits[0] }
  }
  if (hits.length > 1) {
    return { status: 'ambiguous', candidates: hits }
  }
  return null
}

/**
 * Match a raw tour name against the catalog using three ordered steps:
 * aliases, then full name/title, then short name/title. No fuzzy matching.
 */
export function matchTour(
  rawName: string,
  tours: CatalogTour[],
  aliases: CatalogAlias[],
): MatchResult {
  const rawNorm = norm(rawName)
  if (rawNorm === '') {
    return { status: 'none' }
  }

  const steps: CatalogTour[][] = [
    matchByAlias(rawNorm, tours, aliases),
    matchByFullName(rawNorm, tours),
    matchByShortName(rawNorm, tours),
  ]

  for (const hits of steps) {
    const resolved = resolveStep(hits)
    if (resolved !== null) {
      return resolved
    }
  }

  return { status: 'none' }
}
