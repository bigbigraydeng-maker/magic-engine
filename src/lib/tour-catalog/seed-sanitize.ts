/**
 * Read-in hygiene: what comes off the client's website goes through the SAME rules as a save in
 * the editor before it may enter the catalog (design §6.11.1 items 5, 7, 8). Pure, no I/O.
 *
 * The save validator (`validateTourPatch`) is the oracle — no second copy of the limits lives
 * here. It is asked about one value at a time, so a single bad value costs only itself: the field
 * is emptied (a bad list item is dropped) and a read-in note is written; the tour is still read
 * in. Only a tour whose name or identity (slug / destination / tier) is unusable is skipped.
 * Values that pass are kept exactly as the website sent them, so a clean feed reads in unchanged.
 * Images get the shape checks only: there is no host allow-list yet at read-in time.
 */

import type {
  FirstPartyFaq,
  FirstPartyItineraryDay,
  FirstPartyTour,
} from '@/lib/web-intelligence/first-party-tours'
import type { TourPatchContext } from './content-validation'
import { validateTourPatch } from './edit-validation'
import { imageUrlShapeIssue } from './image-rules'
import { hasForbiddenChars } from './text-rules'
import type { CatalogTour } from './types'

type Note = (note: string) => void

const MAX_KEY_LENGTH = 200
const MAX_RELATED_SLUGS = 50

/** Feed text echoed inside a note: short, and nothing that could be markup or invisible. */
export function safeNoteText(text: string): string {
  return Array.from(text.slice(0, 80))
    .map((char) => (hasForbiddenChars(char) || /["'`\\]/.test(char) ? '?' : char))
    .join('')
}

/** Never read: the validator only looks at the stored tour for callers without edit_site. */
const NO_TOUR: CatalogTour = {
  id: '', clientId: '', slug: '', destination: '', tier: '', name: '', title: null, shortDescription: null,
  durationText: null, displayPriceText: null, highlights: [], itinerary: [], inclusions: [], exclusions: [],
  tourCities: [], singleSupplement: null, maxGroupSize: null, isActive: false, managesDepartures: false,
  sortOrder: 0, updatedAt: '', heroImage: null, gallery: [], metaTitle: null, metaDescription: null, tags: [],
  faqs: [], soldOut: false, singleSupplementNote: null, rating: null, reviewCount: null, reviewSummary: null,
  quickAnswer: null, siteExtras: {},
}

/** Every string inside a value, however deeply nested. */
function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(strings)
  if (value !== null && typeof value === 'object') return Object.values(value).flatMap(strings)
  return []
}

/** The validator trims before it looks; the value is stored untrimmed, so look at the raw text too. */
function hasHiddenChars(value: unknown): boolean {
  return strings(value).some((text) => hasForbiddenChars(text.replace(/\r\n/g, '\n'), true))
}

/**
 * Would saving `{ [patchKey]: value }` be refused? Images in the value count as "already in the
 * catalog", which excuses them from the host list and from nothing else.
 */
function refused(patchKey: string, value: unknown): boolean {
  if (hasHiddenChars(value)) return true
  const ctx: TourPatchContext = {
    canEditSite: true,
    imagePool: new Set(strings(value)),
    imageHosts: [],
    clientDomain: null,
    existingTour: NO_TOUR,
  }
  return !validateTourPatch({ [patchKey]: value }, ctx).ok
}

/** One itinerary day on its own: numbered 1 so that the day-numbering rule is not what fails. */
function dayRefused(day: Record<string, unknown>): boolean {
  return refused('itinerary', [{ title: 'x', description: '', ...day, day: 1 }])
}

/** Drop the items the save rules refuse; if what is left still fails (too many, repeats), empty the list. */
function cleanList<T>(items: readonly T[], patchKey: string, field: string, name: string, note: Note): T[] {
  const kept = items.filter((item) => {
    if (!refused(patchKey, [item])) return true
    note(`${field}_item_rejected:${name}`)
    return false
  })
  if (kept.length > 0 && refused(patchKey, kept)) {
    note(`${field}_rejected:${name}`)
    return []
  }
  return kept
}

function cleanImages(items: readonly string[], name: string, note: Note): string[] {
  const kept = items.filter((item) => {
    if (imageUrlShapeIssue(item) === null) return true
    note(`gallery_item_rejected:${name}`)
    return false
  })
  if (kept.length > 0 && refused('gallery', kept)) {
    note(`gallery_rejected:${name}`)
    return []
  }
  return kept
}

function cleanRelatedSlugs(items: readonly string[], name: string, note: Note): string[] {
  const kept = items.filter((item) => {
    if (item.length <= MAX_KEY_LENGTH && !hasForbiddenChars(item)) return true
    note(`related_blog_slugs_item_rejected:${name}`)
    return false
  })
  if (kept.length > MAX_RELATED_SLUGS) {
    note(`related_blog_slugs_rejected:${name}`)
    return []
  }
  return kept
}

/** The optional parts of one day: each is dropped on its own when the save rules refuse it. */
function cleanDay(day: FirstPartyItineraryDay, name: string, note: Note): FirstPartyItineraryDay {
  const out: FirstPartyItineraryDay = { ...day }
  const at = `itinerary.${day.day}`
  if (out.meals !== undefined) {
    out.meals = out.meals.filter((meal) => {
      if (!dayRefused({ meals: [meal] })) return true
      note(`meals_item_rejected:${name}:${day.day}`)
      return false
    })
    if (dayRefused({ meals: out.meals })) {
      note(`meals_rejected:${name}:${day.day}`)
      out.meals = []
    }
  }
  for (const key of ['accommodation', 'festiveLabel'] as const) {
    if (out[key] !== undefined && dayRefused({ [key]: out[key] })) {
      note(`text_rejected:${name}:${at}.${key}`)
      delete out[key]
    }
  }
  const logo = out.operatorLogo
  if (logo !== undefined && (imageUrlShapeIssue(logo.src) !== null || dayRefused({ operatorLogo: logo }))) {
    note(`operator_logo_rejected:${name}:${day.day}`)
    delete out.operatorLogo
  }
  return out
}

/**
 * A day whose title or description is unusable cannot simply be dropped (the days would no longer
 * read 1, 2, 3 …), so it empties the whole itinerary. Day numbering itself is not judged here.
 */
function cleanItinerary(days: readonly FirstPartyItineraryDay[], name: string, note: Note): FirstPartyItineraryDay[] {
  const cleaned = days.map((day) => cleanDay(day, name, note))
  const renumbered = cleaned.map((day, index) => ({ ...day, day: index + 1 }))
  if (cleaned.length > 0 && refused('itinerary', renumbered)) {
    note(`itinerary_rejected:${name}`)
    return []
  }
  return cleaned
}

const TEXT_FIELDS = [
  ['title', 'title'],
  ['short_description', 'shortDescription'],
  ['duration', 'durationText'],
  ['single_supplement', 'singleSupplement'],
  ['meta_title', 'metaTitle'],
  ['meta_description', 'metaDescription'],
  ['single_supplement_note', 'singleSupplementNote'],
  ['review_summary', 'reviewSummary'],
  ['quick_answer', 'quickAnswer'],
] as const

function cleanScalars(out: FirstPartyTour, note: Note): void {
  for (const [field, patchKey] of TEXT_FIELDS) {
    const value = out[field]
    if (value !== undefined && value !== null && refused(patchKey, value)) {
      note(`text_rejected:${out.name}:${field}`)
      delete out[field]
    }
  }
  if (out.max_group_size !== undefined && refused('maxGroupSize', out.max_group_size)) {
    note(`max_group_size_rejected:${out.name}`)
    delete out.max_group_size
  }
  if (out.rating !== undefined && refused('rating', out.rating)) {
    note(`rating_out_of_range:${out.name}`)
    delete out.rating
  }
  if (out.review_count !== undefined && refused('reviewCount', out.review_count)) {
    note(`review_count_invalid:${out.name}`)
    delete out.review_count
  }
  if (out.hero_image !== undefined && out.hero_image !== '' && imageUrlShapeIssue(out.hero_image) !== null) {
    note('hero_image_rejected:' + safeNoteText(out.hero_image))
    delete out.hero_image
  }
}

function cleanLists(out: FirstPartyTour, note: Note): void {
  const name = out.name
  out.tour_cities = cleanList(out.tour_cities, 'tourCities', 'tour_cities', name, note)
  out.inclusions = cleanList(out.inclusions, 'inclusions', 'inclusions', name, note)
  out.exclusions = cleanList(out.exclusions, 'exclusions', 'exclusions', name, note)
  out.itinerary = cleanItinerary(out.itinerary, name, note)
  if (out.highlights !== undefined) out.highlights = cleanList(out.highlights, 'highlights', 'highlights', name, note)
  if (out.tags !== undefined) out.tags = cleanList(out.tags, 'tags', 'tags', name, note)
  if (out.faqs !== undefined) out.faqs = cleanList<FirstPartyFaq>(out.faqs, 'faqs', 'faq', name, note)
  if (out.gallery !== undefined) out.gallery = cleanImages(out.gallery, name, note)
  if (out.related_blog_slugs !== undefined) {
    out.related_blog_slugs = cleanRelatedSlugs(out.related_blog_slugs, name, note)
  }
}

function keyUsable(text: string): boolean {
  return text.trim() !== '' && text.length <= MAX_KEY_LENGTH && !hasForbiddenChars(text)
}

/**
 * The product as it may enter the catalog, or null when the tour has to be skipped. Every value
 * that was emptied or dropped is reported through `note`. The input is not modified.
 */
export function sanitizeSeedProduct(product: FirstPartyTour, note: Note): FirstPartyTour | null {
  if (!keyUsable(product.slug) || !keyUsable(product.destination) || !keyUsable(product.tier ?? 'unknown')) {
    note('tour_skipped_invalid_key:' + safeNoteText(product.slug))
    return null
  }
  if (refused('name', product.name)) {
    note('tour_skipped_invalid_name:' + safeNoteText(product.slug))
    return null
  }
  const out: FirstPartyTour = { ...product }
  cleanScalars(out, note)
  cleanLists(out, note)
  return out
}
