/**
 * Tour catalog — creating a whole new tour (draft only; nothing here publishes).
 * Content fields reuse validateTourPatch; this file adds the identity fields and the first departures.
 */

import type { FieldError } from './text-rules'
import type { TourPatchContext } from './content-validation'
import {
  tourPatchToDb,
  validateNewDeparture,
  validateTourPatch,
  type NewDeparture,
  type TourPatch,
} from './edit-validation'
import type { CatalogTour } from './types'

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/
const MAX_NEW_DEPARTURES = 40
const NEW_TOUR_KEYS = ['destination', 'tier', 'slug', 'tour', 'departures'] as const

export interface NewTourInput {
  destination: string
  tier: string
  slug: string
  patch: TourPatch & { name: string }
  departures: NewDeparture[]
}

export type NewTourResult =
  | { ok: true; value: NewTourInput }
  | { ok: false; errors: FieldError[]; forbidden?: true }

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readIdentity(
  input: Record<string, unknown>,
  field: 'destination' | 'tier',
  errors: FieldError[],
): string {
  const raw = input[field]
  if (typeof raw !== 'string' || raw.trim() === '') {
    errors.push({ field, code: 'required' })
    return ''
  }
  const value = raw.trim()
  if (value.length > 100) errors.push({ field, code: 'too_long' })
  return value
}

function readSlug(input: Record<string, unknown>, errors: FieldError[]): string {
  const raw = input.slug
  if (typeof raw !== 'string' || raw.trim() === '') {
    errors.push({ field: 'slug', code: 'required' })
    return ''
  }
  const value = raw.trim()
  if (value.length > 100 || !SLUG_PATTERN.test(value)) errors.push({ field: 'slug', code: 'invalid_slug' })
  return value
}

function readDepartures(raw: unknown, errors: FieldError[]): NewDeparture[] {
  if (raw === undefined) return []
  if (!Array.isArray(raw) || raw.length > MAX_NEW_DEPARTURES) {
    errors.push({ field: 'departures', code: 'invalid_value' })
    return []
  }
  const out: NewDeparture[] = []
  const seen = new Set<string>()
  raw.forEach((item, index) => {
    const checked = validateNewDeparture(item)
    if (!checked.ok) {
      for (const e of checked.errors) errors.push({ field: `departures[${index}].${e.field}`, code: e.code })
      return
    }
    if (seen.has(checked.value.departOn)) {
      errors.push({ field: `departures[${index}].departOn`, code: 'duplicate' })
      return
    }
    seen.add(checked.value.departOn)
    out.push(checked.value)
  })
  return out
}

/** A tour that does not exist yet: gives the content validator an empty "current" tour to compare against. */
export function blankTour(clientId: string): CatalogTour {
  return {
    id: '',
    clientId,
    slug: '',
    destination: '',
    tier: '',
    name: '',
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
    updatedAt: '',
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
  }
}

export function validateNewTour(input: unknown, ctx: TourPatchContext): NewTourResult {
  if (!isPlainObject(input)) return { ok: false, errors: [{ field: '*', code: 'invalid_body' }] }

  const errors: FieldError[] = []
  for (const key of Object.keys(input)) {
    if (!(NEW_TOUR_KEYS as readonly string[]).includes(key)) errors.push({ field: key, code: 'field_not_editable' })
  }

  const destination = readIdentity(input, 'destination', errors)
  const tier = readIdentity(input, 'tier', errors)
  const slug = readSlug(input, errors)
  const departures = readDepartures(input.departures, errors)

  const content = validateTourPatch(input.tour, ctx)
  if (!content.ok) {
    if (content.forbidden === true) return { ok: false, forbidden: true, errors: content.errors }
    for (const e of content.errors) errors.push({ field: `tour.${e.field}`, code: e.code })
  } else if (typeof content.value.name !== 'string' || content.value.name === '') {
    errors.push({ field: 'tour.name', code: 'required' })
  }

  if (errors.length > 0 || !content.ok) return { ok: false, errors }
  return { ok: true, value: { destination, tier, slug, patch: { ...content.value, name: content.value.name as string }, departures } }
}

/** Column values for the insert; sortOrder puts the new tour after the existing ones. */
export function newTourToDbRow(
  clientId: string,
  value: NewTourInput,
  sortOrder: number,
): Record<string, unknown> {
  return {
    ...tourPatchToDb({ managesDepartures: true, ...value.patch }),
    client_id: clientId,
    destination: value.destination,
    tier: value.tier,
    slug: value.slug,
    sort_order: sortOrder,
  }
}
