/**
 * Route variants: a second way to run one tour for the departures whose route differs
 * (e.g. Panorama's October 2027 departure). They live in the tour's `site_extras` JSON under
 * `route_variants`; the tour's own itinerary stays the default route. Pure, no I/O.
 *
 * Two halves: `validateSiteExtras` checks what an editor sends (strict, collects all errors);
 * `readRouteVariants` reads what is stored (lenient, so a missing or damaged value reads as
 * "no variants" and the tour behaves exactly as it did before this field existed).
 */

import type { CatalogItineraryDay, CatalogRouteVariant } from './types'
import { readDayExtras } from './content-fields'
import { nullableText, requiredText } from './content-validation'
import { isValidIsoDate } from './dates'
import { hasForbiddenChars, type FieldError } from './text-rules'

export const ROUTE_VARIANTS_KEY = 'route_variants'
const RELATED_BLOG_SLUGS_KEY = 'related_blog_slugs'

const MAX_VARIANTS = 4
const MAX_DEPARTURES_PER_VARIANT = 12
const MAX_LABEL_LENGTH = 60
const MAX_NOTE_LENGTH = 200
const MAX_BLOG_SLUGS = 20
const MAX_BLOG_SLUG_LENGTH = 120
/** The table caps site_extras at 20000 bytes of jsonb text, which is wider than JSON.stringify. */
const MAX_SITE_EXTRAS_BYTES = 17000
const ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/
const MAP_SLUG_RE = /^[a-z0-9][a-z0-9-]{0,59}$/

/** Checks an itinerary array the way the tour's own itinerary is checked. */
export type ItineraryValidator = (value: unknown, errors: FieldError[]) => CatalogItineraryDay[] | undefined

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function validateBlogSlugs(value: unknown, errors: FieldError[]): string[] | undefined {
  const field = `siteExtras.${RELATED_BLOG_SLUGS_KEY}`
  if (!Array.isArray(value)) {
    errors.push({ field, code: 'invalid_type' })
    return undefined
  }
  if (value.length > MAX_BLOG_SLUGS) {
    errors.push({ field, code: 'too_many_items' })
    return undefined
  }
  const slugs: string[] = []
  for (const item of value) {
    if (typeof item !== 'string' || item.trim() === '' || item.length > MAX_BLOG_SLUG_LENGTH || hasForbiddenChars(item)) {
      errors.push({ field, code: 'invalid_value' })
      return undefined
    }
    slugs.push(item.trim())
  }
  return slugs
}

function validateVariantDates(value: unknown, prefix: string, errors: FieldError[]): string[] | undefined {
  const field = `${prefix}.departOn`
  if (!Array.isArray(value) || value.length === 0) {
    errors.push({ field, code: Array.isArray(value) ? 'required' : 'invalid_type' })
    return undefined
  }
  if (value.length > MAX_DEPARTURES_PER_VARIANT) {
    errors.push({ field, code: 'too_many_items' })
    return undefined
  }
  const dates: string[] = []
  for (const item of value) {
    if (typeof item !== 'string' || !isValidIsoDate(item)) {
      errors.push({ field, code: 'invalid_date' })
      return undefined
    }
    if (dates.includes(item)) {
      errors.push({ field, code: 'duplicate_date' })
      return undefined
    }
    dates.push(item)
  }
  return dates.slice().sort()
}

function validateVariant(
  value: unknown,
  index: number,
  errors: FieldError[],
  validateItinerary: ItineraryValidator,
): CatalogRouteVariant | undefined {
  const prefix = `siteExtras.${ROUTE_VARIANTS_KEY}[${index}]`
  if (!isPlainObject(value)) {
    errors.push({ field: prefix, code: 'invalid_type' })
    return undefined
  }
  const before = errors.length

  const id = typeof value.id === 'string' && ID_RE.test(value.id) ? value.id : undefined
  if (id === undefined) errors.push({ field: `${prefix}.id`, code: 'invalid_id' })
  const label = requiredText(value.label, `${prefix}.label`, MAX_LABEL_LENGTH, errors)
  const note = value.note === undefined ? null : nullableText(value.note, `${prefix}.note`, MAX_NOTE_LENGTH, errors)
  const departOn = validateVariantDates(value.departOn, prefix, errors)
  const mapSlug = value.mapSlug === undefined || value.mapSlug === null ? null : value.mapSlug
  if (mapSlug !== null && !(typeof mapSlug === 'string' && MAP_SLUG_RE.test(mapSlug))) {
    errors.push({ field: `${prefix}.mapSlug`, code: 'invalid_map_slug' })
  }

  const itineraryErrors: FieldError[] = []
  const itinerary = validateItinerary(value.itinerary, itineraryErrors)
  for (const e of itineraryErrors) errors.push({ field: `${prefix}.${e.field}`, code: e.code })

  if (errors.length > before || id === undefined || label === undefined || departOn === undefined) return undefined
  if (itinerary === undefined || note === undefined) return undefined
  return { id, label, note, departOn, mapSlug: mapSlug as string | null, itinerary }
}

function validateRouteVariants(
  value: unknown,
  errors: FieldError[],
  validateItinerary: ItineraryValidator,
): CatalogRouteVariant[] | undefined {
  const field = `siteExtras.${ROUTE_VARIANTS_KEY}`
  if (!Array.isArray(value)) {
    errors.push({ field, code: 'invalid_type' })
    return undefined
  }
  if (value.length > MAX_VARIANTS) {
    errors.push({ field, code: 'too_many_items' })
    return undefined
  }
  const variants: CatalogRouteVariant[] = []
  let failed = false
  value.forEach((item, index) => {
    const variant = validateVariant(item, index, errors, validateItinerary)
    if (variant === undefined) failed = true
    else variants.push(variant)
  })
  if (failed) return undefined

  const ids = new Set<string>()
  const dates = new Set<string>()
  for (const variant of variants) {
    if (ids.has(variant.id)) {
      errors.push({ field, code: 'duplicate_id' })
      return undefined
    }
    ids.add(variant.id)
    for (const date of variant.departOn) {
      if (dates.has(date)) {
        errors.push({ field, code: 'date_in_two_variants' })
        return undefined
      }
      dates.add(date)
    }
  }
  return variants
}

/**
 * Validate the whole `siteExtras` object an editor sends. Only the two known keys are allowed;
 * the result replaces the stored object, so a caller must send back keys it wants to keep.
 */
export function validateSiteExtras(
  value: unknown,
  errors: FieldError[],
  validateItinerary: ItineraryValidator,
): Record<string, unknown> | undefined {
  if (!isPlainObject(value)) {
    errors.push({ field: 'siteExtras', code: 'invalid_type' })
    return undefined
  }
  const before = errors.length
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(value)) {
    if (key === RELATED_BLOG_SLUGS_KEY) {
      const slugs = validateBlogSlugs(value[key], errors)
      if (slugs !== undefined) out[key] = slugs
    } else if (key === ROUTE_VARIANTS_KEY) {
      const variants = validateRouteVariants(value[key], errors, validateItinerary)
      if (variants !== undefined && variants.length > 0) out[key] = variants
    } else {
      errors.push({ field: `siteExtras.${key}`, code: 'unknown_key' })
    }
  }
  if (errors.length > before) return undefined
  if (new TextEncoder().encode(JSON.stringify(out)).length > MAX_SITE_EXTRAS_BYTES) {
    errors.push({ field: 'siteExtras', code: 'too_large' })
    return undefined
  }
  return out
}

function readStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function readItineraryDay(value: unknown): CatalogItineraryDay | null {
  if (!isPlainObject(value)) return null
  const { day, title, description } = value
  if (typeof day !== 'number' || typeof title !== 'string' || typeof description !== 'string') return null
  const out: CatalogItineraryDay = { day, title, description, ...readDayExtras(value) }
  if (Array.isArray(value.meals)) out.meals = readStringList(value.meals)
  return out
}

/** Lenient reader: anything unreadable is skipped, never thrown. */
export function readRouteVariants(siteExtras: Record<string, unknown>): CatalogRouteVariant[] {
  const raw = siteExtras[ROUTE_VARIANTS_KEY]
  if (!Array.isArray(raw)) return []
  const variants: CatalogRouteVariant[] = []
  for (const item of raw) {
    if (!isPlainObject(item) || typeof item.id !== 'string' || typeof item.label !== 'string') continue
    const itinerary = (Array.isArray(item.itinerary) ? item.itinerary : [])
      .map(readItineraryDay)
      .filter((day): day is CatalogItineraryDay => day !== null)
    if (itinerary.length === 0) continue
    variants.push({
      id: item.id,
      label: item.label,
      note: typeof item.note === 'string' ? item.note : null,
      departOn: readStringList(item.departOn).filter(isValidIsoDate),
      mapSlug: typeof item.mapSlug === 'string' ? item.mapSlug : null,
      itinerary,
    })
  }
  return variants
}
