/**
 * Pure validation for the admin tour-catalog editor. No I/O.
 *
 * Design: docs/specs/2026-10-09-cts-tour-catalog-in-me-design-v0.3.md
 *
 * Collects ALL errors rather than stopping at the first, so the editor can
 * surface every problem in one pass. Only when there are no errors does it
 * return the cleaned patch (trimmed strings, dropped empties, sorted itinerary).
 */

import type { CatalogItineraryDay, DepartureStatus } from './types'
import { DEPARTURE_STATUSES } from './types'
import { MAX_PRICE_TEXT_LENGTH, priceTextSafetyIssue, validatePriceText } from './price'
import { isValidIsoDate } from './dates'

export type FieldError = { field: string; code: string }
export type Result<T> = { ok: true; value: T } | { ok: false; errors: FieldError[] }

export interface TourPatch {
  name?: string
  title?: string | null
  shortDescription?: string | null
  durationText?: string | null
  displayPriceText?: string | null
  highlights?: string[]
  itinerary?: CatalogItineraryDay[]
  inclusions?: string[]
  exclusions?: string[]
  tourCities?: string[]
  singleSupplement?: string | null
  maxGroupSize?: number | null
  isActive?: boolean
  managesDepartures?: boolean
}

const TOUR_PATCH_KEYS: readonly string[] = [
  'name',
  'title',
  'shortDescription',
  'durationText',
  'displayPriceText',
  'highlights',
  'itinerary',
  'inclusions',
  'exclusions',
  'tourCities',
  'singleSupplement',
  'maxGroupSize',
  'isActive',
  'managesDepartures',
]

const MAX_ITEMS = 50
const MAX_ITINERARY_ITEMS = 60
const MAX_ITEM_LENGTH = 500
const MAX_MEALS = 8
const MAX_MEAL_LENGTH = 60 // existing itineraries carry meals like "Dinner (Tibetan Dinner with Cultural Show)" (42 chars)

/**
 * Characters no editable text may contain: C0 control characters and DEL, zero-width characters
 * (U+200B–U+200F), bidirectional overrides (U+202A–U+202E), invisible formatting (U+2060–U+2069)
 * and the byte-order mark. They are invisible in the admin page but change what customers see.
 */
const FORBIDDEN_CHARS_RE = /[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/
/** Same set, except that multi-line fields may contain line breaks and tabs. */
const FORBIDDEN_CHARS_MULTILINE_RE = /[\u0000-\u0008\u000b-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/

export function hasForbiddenChars(text: string, multiline = false): boolean {
  return (multiline ? FORBIDDEN_CHARS_MULTILINE_RE : FORBIDDEN_CHARS_RE).test(text)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Validate a required non-empty string field with a max length. */
function validateRequiredString(
  value: unknown,
  field: string,
  maxLength: number,
  errors: FieldError[],
): string | undefined {
  if (typeof value !== 'string') {
    errors.push({ field, code: 'invalid_type' })
    return undefined
  }
  const trimmed = value.trim()
  if (trimmed === '') {
    errors.push({ field, code: 'required' })
    return undefined
  }
  if (trimmed.length > maxLength) {
    errors.push({ field, code: 'too_long' })
    return undefined
  }
  if (hasForbiddenChars(trimmed)) {
    errors.push({ field, code: 'invalid_characters' })
    return undefined
  }
  return trimmed
}

/** Validate an optional nullable string field; empty string becomes null. */
function validateNullableString(
  value: unknown,
  field: string,
  maxLength: number,
  errors: FieldError[],
  multiline = false,
): string | null | undefined {
  if (value === null) return null
  if (typeof value !== 'string') {
    errors.push({ field, code: 'invalid_type' })
    return undefined
  }
  const trimmed = (multiline ? value.replace(/\r\n/g, '\n') : value).trim()
  if (trimmed === '') return null
  if (trimmed.length > maxLength) {
    errors.push({ field, code: 'too_long' })
    return undefined
  }
  if (hasForbiddenChars(trimmed, multiline)) {
    errors.push({ field, code: 'invalid_characters' })
    return undefined
  }
  return trimmed
}

/** Single supplement: free text like "NZD $400", but with the same shape rules as a price. */
function validateSingleSupplement(value: unknown, errors: FieldError[]): string | null | undefined {
  const text = validateNullableString(value, 'singleSupplement', MAX_PRICE_TEXT_LENGTH, errors)
  if (typeof text !== 'string') return text
  const issue = priceTextSafetyIssue(text)
  if (issue !== null) {
    errors.push({ field: 'singleSupplement', code: 'invalid_price:' + issue })
    return undefined
  }
  return text
}

/** Validate a nullable price display string using validatePriceText. */
function validateNullablePrice(
  value: unknown,
  field: string,
  errors: FieldError[],
): string | null | undefined {
  if (value === null) return null
  if (typeof value !== 'string') {
    errors.push({ field, code: 'invalid_type' })
    return undefined
  }
  const trimmed = value.trim()
  if (trimmed === '') return null
  if (hasForbiddenChars(trimmed)) {
    errors.push({ field, code: 'invalid_characters' })
    return undefined
  }
  const result = validatePriceText(trimmed)
  if (!result.ok) {
    errors.push({ field, code: 'invalid_price:' + result.reason })
    return undefined
  }
  return trimmed
}

/** Validate an array of strings: trim, drop empties, enforce item + count limits. */
function validateStringArray(
  value: unknown,
  field: string,
  errors: FieldError[],
  maxItems: number = MAX_ITEMS,
  maxItemLength: number = MAX_ITEM_LENGTH,
): string[] | undefined {
  if (!Array.isArray(value)) {
    errors.push({ field, code: 'invalid_type' })
    return undefined
  }
  if (value.length > maxItems) {
    errors.push({ field, code: 'too_many_items' })
    return undefined
  }
  const out: string[] = []
  let itemTooLong = false
  let itemHasForbiddenChars = false
  for (const item of value) {
    if (typeof item !== 'string') {
      errors.push({ field, code: 'invalid_type' })
      return undefined
    }
    const trimmed = item.trim()
    if (trimmed === '') continue
    if (trimmed.length > maxItemLength) {
      itemTooLong = true
      continue
    }
    if (hasForbiddenChars(trimmed)) {
      itemHasForbiddenChars = true
      continue
    }
    out.push(trimmed)
  }
  if (itemTooLong) {
    errors.push({ field, code: 'item_too_long' })
    return undefined
  }
  if (itemHasForbiddenChars) {
    errors.push({ field, code: 'invalid_characters' })
    return undefined
  }
  return out
}

/** Day description: multi-line text, kept as typed (line breaks normalised), no hidden characters. */
function validateDayDescription(
  value: unknown,
  field: string,
  errors: FieldError[],
): string | undefined {
  if (typeof value !== 'string') {
    errors.push({ field, code: 'invalid_type' })
    return undefined
  }
  const text = value.replace(/\r\n/g, '\n')
  if (text.length > 5000) {
    errors.push({ field, code: 'too_long' })
    return undefined
  }
  if (hasForbiddenChars(text, true)) {
    errors.push({ field, code: 'invalid_characters' })
    return undefined
  }
  return text
}

/** Validate a single itinerary day object. */
function validateItineraryDay(
  value: unknown,
  index: number,
  errors: FieldError[],
): CatalogItineraryDay | undefined {
  const prefix = `itinerary[${index}]`
  if (!isPlainObject(value)) {
    errors.push({ field: prefix, code: 'invalid_type' })
    return undefined
  }

  const day = value.day
  if (typeof day !== 'number' || !Number.isInteger(day) || day <= 0) {
    errors.push({ field: `${prefix}.day`, code: 'invalid_day' })
  }

  const title = validateRequiredString(value.title, `${prefix}.title`, 200, errors)

  const description = validateDayDescription(value.description, `${prefix}.description`, errors)

  let meals: string[] | undefined
  if (value.meals !== undefined) {
    meals = validateStringArray(value.meals, `${prefix}.meals`, errors, MAX_MEALS, MAX_MEAL_LENGTH)
  }

  if (
    typeof day !== 'number' ||
    !Number.isInteger(day) ||
    day <= 0 ||
    title === undefined ||
    description === undefined
  ) {
    return undefined
  }

  const result: CatalogItineraryDay = { day, title, description }
  if (meals !== undefined) result.meals = meals
  return result
}

/** Validate the itinerary array: per-item checks, duplicate days, sorted output. */
function validateItinerary(
  value: unknown,
  errors: FieldError[],
): CatalogItineraryDay[] | undefined {
  if (!Array.isArray(value)) {
    errors.push({ field: 'itinerary', code: 'invalid_type' })
    return undefined
  }
  if (value.length > MAX_ITINERARY_ITEMS) {
    errors.push({ field: 'itinerary', code: 'too_many_items' })
    return undefined
  }

  const days: CatalogItineraryDay[] = []
  let failed = false
  value.forEach((item, index) => {
    const parsed = validateItineraryDay(item, index, errors)
    if (parsed === undefined) {
      failed = true
    } else {
      days.push(parsed)
    }
  })
  if (failed) return undefined

  const seen = new Set<number>()
  for (const d of days) {
    if (seen.has(d.day)) {
      errors.push({ field: 'itinerary', code: 'duplicate_day' })
      return undefined
    }
    seen.add(d.day)
  }

  const sorted = days.slice().sort((a, b) => a.day - b.day)
  // Days must read 1, 2, 3 ... with no gaps, like the website itinerary.
  if (sorted.some((d, index) => d.day !== index + 1)) {
    errors.push({ field: 'itinerary', code: 'non_consecutive_days' })
    return undefined
  }
  return sorted
}

/** Validate maxGroupSize: null or integer 1..500. */
function validateMaxGroupSize(
  value: unknown,
  errors: FieldError[],
): number | null | undefined {
  if (value === null) return null
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 500) {
    errors.push({ field: 'maxGroupSize', code: 'invalid_number' })
    return undefined
  }
  return value
}

/** Validate a boolean field. */
function validateBoolean(
  value: unknown,
  field: string,
  errors: FieldError[],
): boolean | undefined {
  if (typeof value !== 'boolean') {
    errors.push({ field, code: 'invalid_type' })
    return undefined
  }
  return value
}

/** Reject any keys that are not part of the editable TourPatch surface. */
function collectUnknownKeys(
  input: Record<string, unknown>,
  errors: FieldError[],
): void {
  for (const key of Object.keys(input)) {
    if (!TOUR_PATCH_KEYS.includes(key)) {
      errors.push({ field: key, code: 'field_not_editable' })
    }
  }
}

export function validateTourPatch(input: unknown): Result<TourPatch> {
  if (!isPlainObject(input)) {
    return { ok: false, errors: [{ field: '*', code: 'invalid_body' }] }
  }

  const errors: FieldError[] = []
  collectUnknownKeys(input, errors)

  const recognised = Object.keys(input).filter((k) => TOUR_PATCH_KEYS.includes(k))
  if (recognised.length === 0) {
    return { ok: false, errors: [...errors, { field: '*', code: 'empty_patch' }] }
  }

  const patch: TourPatch = {}

  if ('name' in input) {
    const v = validateRequiredString(input.name, 'name', 200, errors)
    if (v !== undefined) patch.name = v
  }
  if ('title' in input) {
    const v = validateNullableString(input.title, 'title', 200, errors)
    if (v !== undefined) patch.title = v
  }
  if ('shortDescription' in input) {
    const v = validateNullableString(input.shortDescription, 'shortDescription', 2000, errors, true)
    if (v !== undefined) patch.shortDescription = v
  }
  if ('durationText' in input) {
    const v = validateNullableString(input.durationText, 'durationText', 50, errors)
    if (v !== undefined) patch.durationText = v
  }
  if ('displayPriceText' in input) {
    const v = validateNullablePrice(input.displayPriceText, 'displayPriceText', errors)
    if (v !== undefined) patch.displayPriceText = v
  }
  if ('highlights' in input) {
    const v = validateStringArray(input.highlights, 'highlights', errors)
    if (v !== undefined) patch.highlights = v
  }
  if ('itinerary' in input) {
    const v = validateItinerary(input.itinerary, errors)
    if (v !== undefined) patch.itinerary = v
  }
  if ('inclusions' in input) {
    const v = validateStringArray(input.inclusions, 'inclusions', errors)
    if (v !== undefined) patch.inclusions = v
  }
  if ('exclusions' in input) {
    const v = validateStringArray(input.exclusions, 'exclusions', errors)
    if (v !== undefined) patch.exclusions = v
  }
  if ('tourCities' in input) {
    const v = validateStringArray(input.tourCities, 'tourCities', errors)
    if (v !== undefined) patch.tourCities = v
  }
  if ('singleSupplement' in input) {
    const v = validateSingleSupplement(input.singleSupplement, errors)
    if (v !== undefined) patch.singleSupplement = v
  }
  if ('maxGroupSize' in input) {
    const v = validateMaxGroupSize(input.maxGroupSize, errors)
    if (v !== undefined) patch.maxGroupSize = v
  }
  if ('isActive' in input) {
    const v = validateBoolean(input.isActive, 'isActive', errors)
    if (v !== undefined) patch.isActive = v
  }
  if ('managesDepartures' in input) {
    const v = validateBoolean(input.managesDepartures, 'managesDepartures', errors)
    if (v !== undefined) patch.managesDepartures = v
  }

  if (errors.length > 0) return { ok: false, errors }
  return { ok: true, value: patch }
}

export function tourPatchToDb(patch: TourPatch): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if ('name' in patch) out.name = patch.name
  if ('title' in patch) out.title = patch.title
  if ('shortDescription' in patch) out.short_description = patch.shortDescription
  if ('durationText' in patch) out.duration_text = patch.durationText
  if ('displayPriceText' in patch) out.display_price_text = patch.displayPriceText
  if ('highlights' in patch) out.highlights = patch.highlights
  if ('itinerary' in patch) out.itinerary = patch.itinerary
  if ('inclusions' in patch) out.inclusions = patch.inclusions
  if ('exclusions' in patch) out.exclusions = patch.exclusions
  if ('tourCities' in patch) out.tour_cities = patch.tourCities
  if ('singleSupplement' in patch) out.single_supplement = patch.singleSupplement
  if ('maxGroupSize' in patch) out.max_group_size = patch.maxGroupSize
  if ('isActive' in patch) out.is_active = patch.isActive
  if ('managesDepartures' in patch) out.manages_departures = patch.managesDepartures
  return out
}

export interface NewDeparture {
  departOn: string
  returnOn: string
  status: DepartureStatus
  priceTextOverride: string | null
}

const NEW_DEPARTURE_KEYS: readonly string[] = [
  'departOn',
  'returnOn',
  'status',
  'priceTextOverride',
]

function isDepartureStatus(value: unknown): value is DepartureStatus {
  return typeof value === 'string' && (DEPARTURE_STATUSES as readonly string[]).includes(value)
}

export function validateNewDeparture(input: unknown): Result<NewDeparture> {
  if (!isPlainObject(input)) {
    return { ok: false, errors: [{ field: '*', code: 'invalid_body' }] }
  }

  const errors: FieldError[] = []
  for (const key of Object.keys(input)) {
    if (!NEW_DEPARTURE_KEYS.includes(key)) {
      errors.push({ field: key, code: 'field_not_editable' })
    }
  }

  const departOn = input.departOn
  if (typeof departOn !== 'string' || departOn.trim() === '') {
    errors.push({ field: 'departOn', code: 'required' })
  } else if (!isValidIsoDate(departOn)) {
    errors.push({ field: 'departOn', code: 'invalid_date' })
  }

  const returnOn = input.returnOn
  if (typeof returnOn !== 'string' || returnOn.trim() === '') {
    errors.push({ field: 'returnOn', code: 'required' })
  } else if (!isValidIsoDate(returnOn)) {
    errors.push({ field: 'returnOn', code: 'invalid_date' })
  }

  let status: DepartureStatus = 'open'
  if (input.status !== undefined) {
    if (!isDepartureStatus(input.status)) {
      errors.push({ field: 'status', code: 'invalid_status' })
    } else {
      status = input.status
    }
  }

  let priceTextOverride: string | null = null
  if (input.priceTextOverride !== undefined) {
    const v = validateNullablePrice(input.priceTextOverride, 'priceTextOverride', errors)
    if (v !== undefined) priceTextOverride = v
  }

  if (
    errors.length === 0 &&
    typeof departOn === 'string' &&
    typeof returnOn === 'string' &&
    returnOn < departOn
  ) {
    errors.push({ field: 'returnOn', code: 'return_before_depart' })
  }

  if (errors.length > 0) return { ok: false, errors }
  return {
    ok: true,
    value: {
      departOn: departOn as string,
      returnOn: returnOn as string,
      status,
      priceTextOverride,
    },
  }
}

export interface DeparturePatch {
  returnOn?: string | null
  status?: DepartureStatus
  priceTextOverride?: string | null
}

const DEPARTURE_PATCH_KEYS: readonly string[] = ['returnOn', 'status', 'priceTextOverride']

export function validateDeparturePatch(input: unknown): Result<DeparturePatch> {
  if (!isPlainObject(input)) {
    return { ok: false, errors: [{ field: '*', code: 'invalid_body' }] }
  }

  const errors: FieldError[] = []
  for (const key of Object.keys(input)) {
    if (key === 'departOn') {
      errors.push({ field: 'departOn', code: 'depart_on_not_editable' })
    } else if (!DEPARTURE_PATCH_KEYS.includes(key)) {
      errors.push({ field: key, code: 'field_not_editable' })
    }
  }

  const recognised = Object.keys(input).filter((k) => DEPARTURE_PATCH_KEYS.includes(k))
  if (recognised.length === 0) {
    return { ok: false, errors: [...errors, { field: '*', code: 'empty_patch' }] }
  }

  const patch: DeparturePatch = {}

  if ('returnOn' in input) {
    const v = input.returnOn
    if (v === null) {
      patch.returnOn = null
    } else if (typeof v !== 'string' || !isValidIsoDate(v)) {
      errors.push({ field: 'returnOn', code: 'invalid_date' })
    } else {
      patch.returnOn = v
    }
  }

  if ('status' in input) {
    if (!isDepartureStatus(input.status)) {
      errors.push({ field: 'status', code: 'invalid_status' })
    } else {
      patch.status = input.status
    }
  }

  if ('priceTextOverride' in input) {
    const v = validateNullablePrice(input.priceTextOverride, 'priceTextOverride', errors)
    if (v !== undefined) patch.priceTextOverride = v
  }

  if (errors.length > 0) return { ok: false, errors }
  return { ok: true, value: patch }
}

export function departurePatchToDb(patch: DeparturePatch): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if ('returnOn' in patch) out.return_on = patch.returnOn
  if ('status' in patch) out.status = patch.status
  if ('priceTextOverride' in patch) out.price_text_override = patch.priceTextOverride
  return out
}
