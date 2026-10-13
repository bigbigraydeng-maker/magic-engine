/**
 * Whitelist projection of catalog content plus the shared rendering helpers used when comparing
 * what is published with the draft. Split from publish.ts (file-size limit); pure.
 * Design: docs/specs/2026-10-09-cts-tour-catalog-in-me-design-v0.3.md §6.8.1 / §6.11.1
 */

import type { CatalogFaq } from './catalog-contract'
import type { CatalogDeparture, CatalogItineraryDay, CatalogTour, DepartureStatus } from './types'
import type { PublishChange, PublishRisk } from './publish-contract'

export interface CatalogContent {
  tours: CatalogTour[]
  departures: CatalogDeparture[]
}

export interface ProjectedTour {
  id: string
  slug: string
  destination: string
  tier: string
  name: string
  title: string | null
  shortDescription: string | null
  durationText: string | null
  displayPriceText: string | null
  highlights: string[]
  itinerary: CatalogItineraryDay[]
  inclusions: string[]
  exclusions: string[]
  tourCities: string[]
  singleSupplement: string | null
  maxGroupSize: number | null
  isActive: boolean
  managesDepartures: boolean
  sortOrder: number
  heroImage: string | null
  gallery: string[]
  metaTitle: string | null
  metaDescription: string | null
  tags: string[]
  faqs: CatalogFaq[]
  soldOut: boolean
  singleSupplementNote: string | null
  rating: number | null
  reviewCount: number | null
  reviewSummary: string | null
  quickAnswer: string | null
  siteExtras: Record<string, unknown>
}

export interface ProjectedDeparture {
  id: string
  tourId: string
  departOn: string
  returnOn: string | null
  priceTextOverride: string | null
  status: DepartureStatus
}

export interface CatalogProjection {
  tours: ProjectedTour[]
  departures: ProjectedDeparture[]
}


function projectItineraryDay(day: CatalogItineraryDay): CatalogItineraryDay {
  const copy: CatalogItineraryDay = {
    day: day.day,
    title: day.title,
    description: day.description,
  }
  if (day.meals !== undefined) {
    copy.meals = [...day.meals]
  }
  if (day.accommodation !== undefined) copy.accommodation = day.accommodation
  if (day.festiveLabel !== undefined) copy.festiveLabel = day.festiveLabel
  if (day.operatorLogo !== undefined) copy.operatorLogo = { src: day.operatorLogo.src, alt: day.operatorLogo.alt }
  return copy
}

function projectFaq(faq: CatalogFaq): CatalogFaq {
  return { question: faq.question, answer: faq.answer, link: faq.link === null ? null : { href: faq.link.href, label: faq.link.label } }
}

/** The content columns of design §6.11.1. `siteExtras` is passed through whole (it is outward-facing). */
function projectContent(tour: CatalogTour): Pick<
  ProjectedTour,
  | 'heroImage' | 'gallery' | 'metaTitle' | 'metaDescription' | 'tags' | 'faqs' | 'soldOut'
  | 'singleSupplementNote' | 'rating' | 'reviewCount' | 'reviewSummary' | 'quickAnswer' | 'siteExtras'
> {
  return {
    heroImage: tour.heroImage,
    gallery: [...tour.gallery],
    metaTitle: tour.metaTitle,
    metaDescription: tour.metaDescription,
    tags: [...tour.tags],
    faqs: tour.faqs.map(projectFaq),
    soldOut: tour.soldOut,
    singleSupplementNote: tour.singleSupplementNote,
    rating: tour.rating,
    reviewCount: tour.reviewCount,
    reviewSummary: tour.reviewSummary,
    quickAnswer: tour.quickAnswer,
    siteExtras: { ...tour.siteExtras },
  }
}

function projectTour(tour: CatalogTour): ProjectedTour {
  return {
    id: tour.id,
    slug: tour.slug,
    destination: tour.destination,
    tier: tour.tier,
    name: tour.name,
    title: tour.title,
    shortDescription: tour.shortDescription,
    durationText: tour.durationText,
    displayPriceText: tour.displayPriceText,
    highlights: [...tour.highlights],
    itinerary: tour.itinerary.map(projectItineraryDay),
    inclusions: [...tour.inclusions],
    exclusions: [...tour.exclusions],
    tourCities: [...tour.tourCities],
    singleSupplement: tour.singleSupplement,
    maxGroupSize: tour.maxGroupSize,
    isActive: tour.isActive,
    managesDepartures: tour.managesDepartures,
    sortOrder: tour.sortOrder,
    ...projectContent(tour),
  }
}

function projectDeparture(departure: CatalogDeparture): ProjectedDeparture {
  return {
    id: departure.id,
    tourId: departure.tourId,
    departOn: departure.departOn,
    returnOn: departure.returnOn,
    priceTextOverride: departure.priceTextOverride,
    status: departure.status,
  }
}

function compareIds(a: { id: string }, b: { id: string }): number {
  if (a.id < b.id) return -1
  if (a.id > b.id) return 1
  return 0
}

/** Whitelist projection used for comparing and hashing catalog content. */
export function projectCatalog(content: CatalogContent): CatalogProjection {
  const tours = content.tours.map(projectTour).sort(compareIds)
  const departures = content.departures.map(projectDeparture).sort(compareIds)
  return { tours, departures }
}

// ---------------------------------------------------------------------------
// Field specs and rendering
// ---------------------------------------------------------------------------

const MAX_RENDER = 200
const CONTEXT_BEFORE = 40
const ELLIPSIS = '…'

export interface FieldSpec {
  field: keyof ProjectedTour
  fieldLabel: string
  risk: PublishRisk
}

export const TOUR_FIELD_SPECS: readonly FieldSpec[] = [
  { field: 'name', fieldLabel: '团名', risk: 'high' },
  { field: 'title', fieldLabel: '对外标题', risk: 'high' },
  { field: 'displayPriceText', fieldLabel: '展示价', risk: 'high' },
  { field: 'singleSupplement', fieldLabel: '单房差', risk: 'high' },
  { field: 'isActive', fieldLabel: '是否在售', risk: 'high' },
  { field: 'managesDepartures', fieldLabel: '是否管理班期', risk: 'high' },
  { field: 'shortDescription', fieldLabel: '行程简介', risk: 'normal' },
  { field: 'durationText', fieldLabel: '天数', risk: 'normal' },
  { field: 'highlights', fieldLabel: '亮点', risk: 'normal' },
  { field: 'inclusions', fieldLabel: '包含项目', risk: 'normal' },
  { field: 'exclusions', fieldLabel: '不含项目', risk: 'normal' },
  { field: 'tourCities', fieldLabel: '途经城市', risk: 'normal' },
  { field: 'maxGroupSize', fieldLabel: '每团人数上限', risk: 'normal' },
  { field: 'sortOrder', fieldLabel: '排序', risk: 'normal' },
  { field: 'slug', fieldLabel: '网址标识', risk: 'normal' },
  { field: 'destination', fieldLabel: '目的地', risk: 'normal' },
  { field: 'tier', fieldLabel: '档位', risk: 'normal' },
  // Content columns (design §6.11.1 item 10). Gallery, FAQs and site extras are compared in publish-content.ts.
  { field: 'heroImage', fieldLabel: '主图', risk: 'high' },
  { field: 'soldOut', fieldLabel: '整团售罄', risk: 'high' },
  { field: 'singleSupplementNote', fieldLabel: '单房差说明', risk: 'high' },
  { field: 'rating', fieldLabel: '评分', risk: 'high' },
  { field: 'reviewCount', fieldLabel: '评价数', risk: 'high' },
  { field: 'reviewSummary', fieldLabel: '评价摘要', risk: 'high' },
  { field: 'metaTitle', fieldLabel: '搜索标题', risk: 'high' },
  { field: 'metaDescription', fieldLabel: '搜索描述', risk: 'high' },
  { field: 'tags', fieldLabel: '标签', risk: 'normal' },
  { field: 'quickAnswer', fieldLabel: '快速回答', risk: 'normal' },
]

function renderScalar(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null
  }
  if (typeof value === 'boolean') {
    return value ? '在售' : '停售'
  }
  if (typeof value === 'string') {
    return value
  }
  if (typeof value === 'number') {
    return String(value)
  }
  return null
}

export function renderField(field: keyof ProjectedTour, value: unknown): string | null {
  if (field === 'managesDepartures') {
    return value === true ? '是' : '否'
  }
  if (field === 'soldOut') {
    return value === true ? '已售罄' : '未售罄'
  }
  if (Array.isArray(value)) {
    const items = value.filter((item): item is string => typeof item === 'string')
    return items.join('；')
  }
  return renderScalar(value)
}

export function arraysEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) {
    return false
  }
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) {
      return false
    }
  }
  return true
}

export function fieldValuesEqual(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return arraysEqual(
      a.filter((item): item is string => typeof item === 'string'),
      b.filter((item): item is string => typeof item === 'string'),
    )
  }
  return a === b
}

function firstDifference(a: string, b: string): number {
  const shared = Math.min(a.length, b.length)
  for (let i = 0; i < shared; i += 1) {
    if (a[i] !== b[i]) {
      return i
    }
  }
  return shared
}

function windowAt(value: string | null, start: number): string | null {
  if (value === null) {
    return null
  }
  const end = start + MAX_RENDER
  const body = value.slice(start, end)
  return `${start > 0 ? ELLIPSIS : ''}${body}${end < value.length ? ELLIPSIS : ''}`
}

/**
 * Short values are shown whole. Long ones are cut to a window around the FIRST difference, so
 * the two columns never look identical just because the change sits past the cut-off.
 */
export function renderPair(before: string | null, after: string | null): { before: string | null; after: string | null } {
  const beforeLength = before === null ? 0 : before.length
  const afterLength = after === null ? 0 : after.length
  if (beforeLength <= MAX_RENDER && afterLength <= MAX_RENDER) {
    return { before, after }
  }
  const diffAt = before === null || after === null ? 0 : firstDifference(before, after)
  const start = Math.max(0, diffAt - CONTEXT_BEFORE)
  return { before: windowAt(before, start), after: windowAt(after, start) }
}

export function makeChange(
  partial: Omit<PublishChange, 'before' | 'after'>,
  before: string | null,
  after: string | null,
): PublishChange {
  return { ...partial, ...renderPair(before, after) }
}
