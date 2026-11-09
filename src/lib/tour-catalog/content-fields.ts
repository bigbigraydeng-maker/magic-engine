/**
 * Lenient readers for the content columns added in 20261010400000_tour_catalog_content.sql
 * (design §6.11.1). Used for database rows AND published snapshots: a value that is missing or
 * has the wrong type reads as "not there" (null / [] / false / {}), so a snapshot taken before
 * the columns existed behaves exactly as it did then. No I/O, no imports from store.ts.
 */

import type { CatalogFaq } from './catalog-contract'
import type { CatalogOperatorLogo, CatalogTour } from './types'

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

/** numeric columns arrive as numbers from PostgREST, but as strings from some drivers. */
function nullableNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value)
  return null
}

function readFaqLink(value: unknown): CatalogFaq['link'] {
  if (!isPlainObject(value)) return null
  const { href, label } = value
  return typeof href === 'string' && typeof label === 'string' ? { href, label } : null
}

export function readFaqs(value: unknown): CatalogFaq[] {
  if (!Array.isArray(value)) return []
  const faqs: CatalogFaq[] = []
  for (const item of value) {
    if (!isPlainObject(item) || typeof item.question !== 'string' || typeof item.answer !== 'string') continue
    faqs.push({ question: item.question, answer: item.answer, link: readFaqLink(item.link) })
  }
  return faqs
}

export function readOperatorLogo(value: unknown): CatalogOperatorLogo | undefined {
  if (!isPlainObject(value) || typeof value.src !== 'string' || value.src === '' || typeof value.alt !== 'string') {
    return undefined
  }
  return { src: value.src, alt: value.alt }
}

/** The optional per-day keys; absent or unreadable values are simply not set. */
export function readDayExtras(rec: Record<string, unknown>): {
  accommodation?: string
  festiveLabel?: string
  operatorLogo?: CatalogOperatorLogo
} {
  const out: { accommodation?: string; festiveLabel?: string; operatorLogo?: CatalogOperatorLogo } = {}
  if (typeof rec.accommodation === 'string' && rec.accommodation !== '') out.accommodation = rec.accommodation
  if (typeof rec.festiveLabel === 'string' && rec.festiveLabel !== '') out.festiveLabel = rec.festiveLabel
  const logo = readOperatorLogo(rec.operatorLogo)
  if (logo !== undefined) out.operatorLogo = logo
  return out
}

export type TourContentFields = Pick<
  CatalogTour,
  | 'heroImage'
  | 'gallery'
  | 'metaTitle'
  | 'metaDescription'
  | 'tags'
  | 'faqs'
  | 'soldOut'
  | 'singleSupplementNote'
  | 'rating'
  | 'reviewCount'
  | 'reviewSummary'
  | 'quickAnswer'
  | 'siteExtras'
>

export function readTourContent(row: Record<string, unknown>): TourContentFields {
  return {
    heroImage: nullableString(row.hero_image),
    gallery: stringList(row.gallery),
    metaTitle: nullableString(row.meta_title),
    metaDescription: nullableString(row.meta_description),
    tags: stringList(row.tags),
    faqs: readFaqs(row.faqs),
    soldOut: row.sold_out === true,
    singleSupplementNote: nullableString(row.single_supplement_note),
    rating: nullableNumber(row.rating),
    reviewCount: nullableNumber(row.review_count),
    reviewSummary: nullableString(row.review_summary),
    quickAnswer: nullableString(row.quick_answer),
    siteExtras: isPlainObject(row.site_extras) ? { ...row.site_extras } : {},
  }
}
