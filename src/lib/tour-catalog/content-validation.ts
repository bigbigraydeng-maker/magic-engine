/**
 * Pure validation for the site-facing fields of the admin tour-catalog editor. No I/O.
 *
 * The content fields added in design §6.11.1: images, SEO, tags, FAQs, the sold-out banner, the
 * single-supplement note, ratings, the quick answer, and the per-day extras of the itinerary.
 * Two tiers, enforced here on the server: SITE_ONLY_PATCH_KEYS, new image addresses and operator
 * logos need `canEditSite` (global admin); a client editor may only pick, reorder or remove
 * images the catalog already uses. Collects ALL errors rather than stopping at the first.
 */

import type { CatalogFaq } from './catalog-contract'
import type { CatalogItineraryDay, CatalogOperatorLogo, CatalogTour } from './types'
import { hasForbiddenChars, type FieldError } from './text-rules'
import { imageUrlIssue, type ImageRuleContext } from './image-rules'

export interface TourPatchContext extends ImageRuleContext {
  /** True only for a global admin (capability edit_site). */
  canEditSite: boolean
  /** The tour as it is now in the draft. */
  existingTour: CatalogTour
}

export interface TourContentPatch {
  heroImage?: string | null
  gallery?: string[]
  metaTitle?: string | null
  metaDescription?: string | null
  tags?: string[]
  faqs?: CatalogFaq[]
  soldOut?: boolean
  singleSupplementNote?: string | null
  rating?: number | null
  reviewCount?: number | null
  reviewSummary?: string | null
  quickAnswer?: string | null
}

/** All twelve keys above, in that order. */
export const CONTENT_PATCH_KEYS: readonly string[] = [
  'heroImage',
  'gallery',
  'metaTitle',
  'metaDescription',
  'tags',
  'faqs',
  'soldOut',
  'singleSupplementNote',
  'rating',
  'reviewCount',
  'reviewSummary',
  'quickAnswer',
]

/** Keys only a global admin may send. */
export const SITE_ONLY_PATCH_KEYS: readonly string[] = [
  'rating',
  'reviewCount',
  'reviewSummary',
  'metaTitle',
  'metaDescription',
  'tags',
  'faqs',
  'quickAnswer',
]

export interface DayExtras {
  accommodation?: string
  festiveLabel?: string
  operatorLogo?: CatalogOperatorLogo
}

const MAX_GALLERY_ITEMS = 30
const MAX_TAGS = 30
const MAX_TAG_LENGTH = 60
const MAX_FAQS = 12
const MAX_QUESTION_LENGTH = 300
const MAX_ANSWER_LENGTH = 1000
const MAX_LINK_HREF_LENGTH = 200
const MAX_LINK_LABEL_LENGTH = 200
const MAX_META_TITLE_LENGTH = 120
const MAX_META_DESCRIPTION_LENGTH = 400
const MAX_QUICK_ANSWER_LENGTH = 1500
const MAX_NOTE_LENGTH = 300
const MAX_REVIEW_SUMMARY_LENGTH = 300
const MAX_ACCOMMODATION_LENGTH = 300
const MAX_FESTIVE_LABEL_LENGTH = 60
const MAX_LOGO_ALT_LENGTH = 200
const MAX_REVIEW_COUNT = 10_000_000

const LINK_HREF_RE = /^\/[a-z0-9/-]+$/

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Nullable single-line text: null → null, empty after trim → null. */
function nullableText(
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

/** Required single-line text: trimmed, non-empty, within the limit. */
function requiredText(
  value: unknown,
  field: string,
  maxLength: number,
  errors: FieldError[],
  multiline = false,
): string | undefined {
  if (typeof value !== 'string') {
    errors.push({ field, code: 'invalid_type' })
    return undefined
  }
  const trimmed = (multiline ? value.replace(/\r\n/g, '\n') : value).trim()
  if (trimmed === '') {
    errors.push({ field, code: 'required' })
    return undefined
  }
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

/** Lower-case, runs of non-alphanumerics become one '-', leading/trailing '-' stripped. */
export function slugifyTag(tag: string): string {
  return tag
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function validateHeroImage(
  value: unknown,
  ctx: TourPatchContext,
  errors: FieldError[],
): string | null | undefined {
  if (value === null) return null
  if (typeof value !== 'string') {
    errors.push({ field: 'heroImage', code: 'invalid_type' })
    return undefined
  }
  const trimmed = value.trim()
  if (trimmed === '') return null
  const issue = imageUrlIssue(trimmed, ctx)
  if (issue !== null) {
    errors.push({ field: 'heroImage', code: issue })
    return undefined
  }
  return trimmed
}

function validateGallery(
  value: unknown,
  ctx: TourPatchContext,
  errors: FieldError[],
): string[] | undefined {
  if (!Array.isArray(value)) {
    errors.push({ field: 'gallery', code: 'invalid_type' })
    return undefined
  }
  if (value.length > MAX_GALLERY_ITEMS) {
    errors.push({ field: 'gallery', code: 'too_many_items' })
    return undefined
  }
  const out: string[] = []
  value.forEach((item, index) => {
    if (typeof item !== 'string') {
      errors.push({ field: `gallery[${index}]`, code: 'invalid_type' })
      return
    }
    const trimmed = item.trim()
    if (trimmed === '') return
    const issue = imageUrlIssue(trimmed, ctx)
    if (issue !== null) {
      errors.push({ field: `gallery[${index}]`, code: issue })
      return
    }
    out.push(trimmed)
  })
  return out
}

function validateTags(value: unknown, errors: FieldError[]): string[] | undefined {
  if (!Array.isArray(value)) {
    errors.push({ field: 'tags', code: 'invalid_type' })
    return undefined
  }
  if (value.length > MAX_TAGS) {
    errors.push({ field: 'tags', code: 'too_many_items' })
    return undefined
  }
  const out: string[] = []
  const seen = new Set<string>()
  value.forEach((item, index) => {
    const field = `tags[${index}]`
    if (typeof item !== 'string') {
      errors.push({ field, code: 'invalid_type' })
      return
    }
    const trimmed = item.trim()
    if (trimmed === '') return
    if (trimmed.length > MAX_TAG_LENGTH) {
      errors.push({ field, code: 'item_too_long' })
      return
    }
    if (hasForbiddenChars(trimmed)) {
      errors.push({ field, code: 'invalid_characters' })
      return
    }
    const slug = slugifyTag(trimmed)
    if (slug === '') {
      errors.push({ field, code: 'invalid_tag' })
      return
    }
    if (seen.has(slug)) {
      errors.push({ field, code: 'duplicate_tag' })
      return
    }
    seen.add(slug)
    out.push(trimmed)
  })
  return out
}

function validateFaqLink(
  value: unknown,
  field: string,
  errors: FieldError[],
): CatalogFaq['link'] | undefined {
  if (value === undefined || value === null) return null
  if (!isPlainObject(value)) {
    errors.push({ field, code: 'invalid_type' })
    return undefined
  }
  const href = value.href
  let hrefOk = false
  if (typeof href !== 'string' || href.length > MAX_LINK_HREF_LENGTH) {
    errors.push({ field: `${field}.href`, code: 'invalid_link' })
  } else if (!LINK_HREF_RE.test(href) || href.includes('//')) {
    errors.push({ field: `${field}.href`, code: 'invalid_link' })
  } else if (href.startsWith('/api/') || href.startsWith('/admin') || href.startsWith('/marketing')) {
    errors.push({ field: `${field}.href`, code: 'invalid_link' })
  } else {
    hrefOk = true
  }
  const label = requiredText(value.label, `${field}.label`, MAX_LINK_LABEL_LENGTH, errors)
  if (!hrefOk || label === undefined) return undefined
  return { href: href as string, label }
}

function validateFaqs(value: unknown, errors: FieldError[]): CatalogFaq[] | undefined {
  if (!Array.isArray(value)) {
    errors.push({ field: 'faqs', code: 'invalid_type' })
    return undefined
  }
  if (value.length > MAX_FAQS) {
    errors.push({ field: 'faqs', code: 'too_many_items' })
    return undefined
  }
  const out: CatalogFaq[] = []
  let failed = false
  value.forEach((item, index) => {
    const prefix = `faqs[${index}]`
    if (!isPlainObject(item)) {
      errors.push({ field: prefix, code: 'invalid_type' })
      failed = true
      return
    }
    const question = requiredText(item.question, `${prefix}.question`, MAX_QUESTION_LENGTH, errors)
    const answer = requiredText(item.answer, `${prefix}.answer`, MAX_ANSWER_LENGTH, errors, true)
    const link = validateFaqLink(item.link, `${prefix}.link`, errors)
    if (question === undefined || answer === undefined || link === undefined) {
      failed = true
      return
    }
    out.push({ question, answer, link })
  })
  return failed ? undefined : out
}

function validateRating(value: unknown, errors: FieldError[]): number | null | undefined {
  if (value === null) return null
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    errors.push({ field: 'rating', code: 'invalid_number' })
    return undefined
  }
  if (value < 0 || value > 5 || Math.round(value * 10) / 10 !== value) {
    errors.push({ field: 'rating', code: 'invalid_number' })
    return undefined
  }
  return value
}

function validateReviewCount(value: unknown, errors: FieldError[]): number | null | undefined {
  if (value === null) return null
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > MAX_REVIEW_COUNT) {
    errors.push({ field: 'reviewCount', code: 'invalid_number' })
    return undefined
  }
  return value
}

/** True when the caller may not touch this key at all. */
function isForbiddenKey(key: string, ctx: TourPatchContext): boolean {
  return !ctx.canEditSite && SITE_ONLY_PATCH_KEYS.includes(key)
}

/** True when an editor is trying to introduce an image address the catalog does not use yet. */
function isForbiddenImage(value: unknown, ctx: TourPatchContext): boolean {
  if (ctx.canEditSite) return false
  const isNew = (item: unknown): boolean =>
    typeof item === 'string' && item.trim() !== '' && !ctx.imagePool.has(item.trim())
  return Array.isArray(value) ? value.some(isNew) : isNew(value)
}

/** Images, sold-out switch and the single-supplement note: keys a client editor may send too. */
function validateSharedKeys(
  input: Record<string, unknown>,
  ctx: TourPatchContext,
  errors: FieldError[],
  patch: TourContentPatch,
): void {
  if ('heroImage' in input) {
    const v = validateHeroImage(input.heroImage, ctx, errors)
    if (v !== undefined) patch.heroImage = v
  }
  if ('gallery' in input) {
    const v = validateGallery(input.gallery, ctx, errors)
    if (v !== undefined) patch.gallery = v
  }
  if ('soldOut' in input) {
    if (typeof input.soldOut !== 'boolean') {
      errors.push({ field: 'soldOut', code: 'invalid_type' })
    } else {
      patch.soldOut = input.soldOut
    }
  }
  if ('singleSupplementNote' in input) {
    const v = nullableText(input.singleSupplementNote, 'singleSupplementNote', MAX_NOTE_LENGTH, errors)
    if (v !== undefined) patch.singleSupplementNote = v
  }
}

/** The SITE_ONLY_PATCH_KEYS. */
function validateSiteOnlyKeys(input: Record<string, unknown>, errors: FieldError[], patch: TourContentPatch): void {
  if ('metaTitle' in input) {
    const v = nullableText(input.metaTitle, 'metaTitle', MAX_META_TITLE_LENGTH, errors)
    if (v !== undefined) patch.metaTitle = v
  }
  if ('metaDescription' in input) {
    const v = nullableText(input.metaDescription, 'metaDescription', MAX_META_DESCRIPTION_LENGTH, errors)
    if (v !== undefined) patch.metaDescription = v
  }
  if ('tags' in input) {
    const v = validateTags(input.tags, errors)
    if (v !== undefined) patch.tags = v
  }
  if ('faqs' in input) {
    const v = validateFaqs(input.faqs, errors)
    if (v !== undefined) patch.faqs = v
  }
  if ('rating' in input) {
    const v = validateRating(input.rating, errors)
    if (v !== undefined) patch.rating = v
  }
  if ('reviewCount' in input) {
    const v = validateReviewCount(input.reviewCount, errors)
    if (v !== undefined) patch.reviewCount = v
  }
  if ('reviewSummary' in input) {
    const v = nullableText(input.reviewSummary, 'reviewSummary', MAX_REVIEW_SUMMARY_LENGTH, errors)
    if (v !== undefined) patch.reviewSummary = v
  }
  if ('quickAnswer' in input) {
    const v = nullableText(input.quickAnswer, 'quickAnswer', MAX_QUICK_ANSWER_LENGTH, errors, true)
    if (v !== undefined) patch.quickAnswer = v
  }
}

/**
 * `forbidden` = the caller is not allowed to send this at all (the route answers 403 and nothing
 * else in the result matters): a site-only key, or an image address that is new to the catalog,
 * from someone without `canEditSite`.
 */
export function validateContentFields(
  input: Record<string, unknown>,
  ctx: TourPatchContext,
  errors: FieldError[],
): { patch: TourContentPatch; forbidden: boolean } {
  const forbidden =
    Object.keys(input).some((key) => isForbiddenKey(key, ctx)) ||
    isForbiddenImage(input.heroImage, ctx) ||
    isForbiddenImage(input.gallery, ctx)
  const patch: TourContentPatch = {}
  validateSharedKeys(input, ctx, errors, patch)
  validateSiteOnlyKeys(input, errors, patch)
  return { patch, forbidden }
}

/** Optional single-line extra: undefined/null → not set, empty after trim → not set. */
function optionalExtra(
  value: unknown,
  field: string,
  maxLength: number,
  errors: FieldError[],
): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') {
    errors.push({ field, code: 'invalid_type' })
    return undefined
  }
  const trimmed = value.trim()
  if (trimmed === '') return undefined
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

function validateOperatorLogo(
  value: unknown,
  prefix: string,
  ctx: TourPatchContext,
  errors: FieldError[],
): CatalogOperatorLogo | undefined {
  if (value === undefined || value === null) return undefined
  const field = `${prefix}.operatorLogo`
  if (!isPlainObject(value)) {
    errors.push({ field, code: 'invalid_type' })
    return undefined
  }
  const src = value.src
  let srcOk = false
  if (typeof src !== 'string' || src.trim() === '') {
    errors.push({ field, code: 'invalid_type' })
  } else {
    const trimmed = src.trim()
    const issue = imageUrlIssue(trimmed, ctx)
    if (issue !== null) {
      errors.push({ field: `${field}.src`, code: issue })
    } else {
      srcOk = true
    }
  }
  const alt = value.alt
  let altOk = false
  if (typeof alt !== 'string') {
    errors.push({ field, code: 'invalid_type' })
  } else {
    const trimmed = alt.trim()
    if (trimmed.length > MAX_LOGO_ALT_LENGTH) {
      errors.push({ field: `${field}.alt`, code: 'too_long' })
    } else if (hasForbiddenChars(trimmed)) {
      errors.push({ field: `${field}.alt`, code: 'invalid_characters' })
    } else {
      altOk = true
    }
  }
  if (!srcOk || !altOk) return undefined
  return { src: (src as string).trim(), alt: (alt as string).trim() }
}

export function validateDayExtras(
  value: Record<string, unknown>,
  prefix: string,
  ctx: TourPatchContext,
  errors: FieldError[],
): DayExtras {
  const out: DayExtras = {}
  const accommodation = optionalExtra(
    value.accommodation,
    `${prefix}.accommodation`,
    MAX_ACCOMMODATION_LENGTH,
    errors,
  )
  if (accommodation !== undefined) out.accommodation = accommodation
  const festiveLabel = optionalExtra(
    value.festiveLabel,
    `${prefix}.festiveLabel`,
    MAX_FESTIVE_LABEL_LENGTH,
    errors,
  )
  if (festiveLabel !== undefined) out.festiveLabel = festiveLabel
  const operatorLogo = validateOperatorLogo(value.operatorLogo, prefix, ctx, errors)
  if (operatorLogo !== undefined) out.operatorLogo = operatorLogo
  return out
}

/** The logo of a day number, or null when the day is absent or carries no logo. */
function logoOf(days: readonly CatalogItineraryDay[], day: number): CatalogOperatorLogo | null {
  for (const item of days) {
    if (item.day === day) return item.operatorLogo ?? null
  }
  return null
}

function logosDiffer(a: CatalogOperatorLogo | null, b: CatalogOperatorLogo | null): boolean {
  if (a === null && b === null) return false
  if (a === null || b === null) return true
  return a.src !== b.src || a.alt !== b.alt
}

export function operatorLogosChanged(
  existing: readonly CatalogItineraryDay[],
  next: readonly CatalogItineraryDay[],
): boolean {
  const days = new Set<number>()
  for (const item of existing) days.add(item.day)
  for (const item of next) days.add(item.day)
  for (const day of days) {
    if (logosDiffer(logoOf(existing, day), logoOf(next, day))) return true
  }
  return false
}

export function contentPatchToDb(patch: TourContentPatch): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if ('heroImage' in patch) out.hero_image = patch.heroImage
  if ('gallery' in patch) out.gallery = patch.gallery
  if ('metaTitle' in patch) out.meta_title = patch.metaTitle
  if ('metaDescription' in patch) out.meta_description = patch.metaDescription
  if ('tags' in patch) out.tags = patch.tags
  if ('faqs' in patch) out.faqs = patch.faqs
  if ('soldOut' in patch) out.sold_out = patch.soldOut
  if ('singleSupplementNote' in patch) out.single_supplement_note = patch.singleSupplementNote
  if ('rating' in patch) out.rating = patch.rating
  if ('reviewCount' in patch) out.review_count = patch.reviewCount
  if ('reviewSummary' in patch) out.review_summary = patch.reviewSummary
  if ('quickAnswer' in patch) out.quick_answer = patch.quickAnswer
  return out
}
