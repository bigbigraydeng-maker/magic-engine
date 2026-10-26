/** Form state of the tour editor and the "send only what changed" patch built from it. No React here. */

import type { CatalogFaq } from '@/lib/tour-catalog/catalog-contract'
import type { CatalogItineraryDayView, CatalogOperatorLogoView, CatalogTourView } from './types'
import { fieldRoot, type FieldErrors } from './editor-parts'

export const GALLERY_MAX = 30
export const FAQ_MAX = 12
export const TAG_MAX = 30
export const META_TITLE_MAX = 120
export const META_DESCRIPTION_MAX = 400
export const QUICK_ANSWER_MAX = 1500

export interface DayDraft {
  title: string
  description: string
  meals: string
  mealsTouched: boolean
  originalMeals: string[]
  accommodation: string
  festiveLabel: string
  /** Not editable here; goes back to the server exactly as it came. */
  operatorLogo?: CatalogOperatorLogoView
}

export interface FaqDraft {
  question: string
  answer: string
  href: string
  label: string
}

export interface FormState {
  name: string
  title: string
  durationText: string
  displayPriceText: string
  singleSupplement: string
  singleSupplementNote: string
  maxGroupSize: string
  shortDescription: string
  highlights: string
  inclusions: string
  exclusions: string
  tourCities: string
  isActive: boolean
  soldOut: boolean
  managesDepartures: boolean
  days: DayDraft[]
  heroImage: string | null
  gallery: string[]
  faqs: FaqDraft[]
  metaTitle: string
  metaDescription: string
  quickAnswer: string
  tags: string[]
  rating: string
  reviewCount: string
  reviewSummary: string
}

export type GroupId = 'basics' | 'images' | 'itinerary' | 'inclusions' | 'faqs' | 'search' | 'reviews'

/** Groups only a Magic Engine admin sees. */
export const SITE_ONLY_GROUPS: GroupId[] = ['faqs', 'search', 'reviews']

const FIELD_GROUPS: Record<string, GroupId> = {
  heroImage: 'images',
  gallery: 'images',
  itinerary: 'itinerary',
  inclusions: 'inclusions',
  exclusions: 'inclusions',
  faqs: 'faqs',
  metaTitle: 'search',
  metaDescription: 'search',
  quickAnswer: 'search',
  tags: 'search',
  rating: 'reviews',
  reviewCount: 'reviews',
  reviewSummary: 'reviews',
}

/** Which folding group a patch key or a server field path lives in. Unknown fields count as basics. */
export function groupOfField(path: string): GroupId {
  return FIELD_GROUPS[fieldRoot(path)] ?? 'basics'
}

export function groupsOf(paths: string[]): Set<GroupId> {
  return new Set(paths.map(groupOfField))
}

function linesToText(items?: string[]): string {
  return (items ?? []).join('\n')
}

function numberToText(value: number | null | undefined): string {
  return value == null ? '' : String(value)
}

export function emptyDay(): DayDraft {
  return {
    title: '',
    description: '',
    meals: '',
    mealsTouched: false,
    originalMeals: [],
    accommodation: '',
    festiveLabel: '',
  }
}

function daysFromTour(tour: CatalogTourView): DayDraft[] {
  return (tour.itinerary ?? []).map((d) => ({
    title: d.title ?? '',
    description: d.description ?? '',
    meals: (d.meals ?? []).join(', '),
    mealsTouched: false,
    originalMeals: d.meals ?? [],
    accommodation: d.accommodation ?? '',
    festiveLabel: d.festiveLabel ?? '',
    operatorLogo: d.operatorLogo,
  }))
}

function faqsFromTour(tour: CatalogTourView): FaqDraft[] {
  return (tour.faqs ?? []).map((f) => ({
    question: f.question ?? '',
    answer: f.answer ?? '',
    href: f.link?.href ?? '',
    label: f.link?.label ?? '',
  }))
}

export function initialForm(tour: CatalogTourView): FormState {
  return {
    name: tour.name ?? '',
    title: tour.title ?? '',
    durationText: tour.durationText ?? '',
    displayPriceText: tour.displayPriceText ?? '',
    singleSupplement: tour.singleSupplement ?? '',
    singleSupplementNote: tour.singleSupplementNote ?? '',
    maxGroupSize: numberToText(tour.maxGroupSize),
    shortDescription: tour.shortDescription ?? '',
    highlights: linesToText(tour.highlights),
    inclusions: linesToText(tour.inclusions),
    exclusions: linesToText(tour.exclusions),
    tourCities: linesToText(tour.tourCities),
    isActive: tour.isActive,
    soldOut: tour.soldOut === true,
    managesDepartures: tour.managesDepartures,
    days: daysFromTour(tour),
    heroImage: tour.heroImage ?? null,
    gallery: tour.gallery ?? [],
    faqs: faqsFromTour(tour),
    metaTitle: tour.metaTitle ?? '',
    metaDescription: tour.metaDescription ?? '',
    quickAnswer: tour.quickAnswer ?? '',
    tags: tour.tags ?? [],
    rating: numberToText(tour.rating),
    reviewCount: numberToText(tour.reviewCount),
    reviewSummary: tour.reviewSummary ?? '',
  }
}

function splitBy(text: string, separator: string): string[] {
  return text
    .split(separator)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

function nullableText(value: string): string | null {
  const trimmed = value.trim()
  return trimmed.length === 0 ? null : trimmed
}

function nullableNumber(value: string): number | null {
  return value.trim() === '' ? null : Number(value)
}

function buildItinerary(days: DayDraft[]): CatalogItineraryDayView[] {
  return days.map((d, i) => {
    const day: CatalogItineraryDayView = {
      day: i + 1,
      title: d.title.trim(),
      description: d.description.trim(),
    }
    const meals = d.mealsTouched ? splitBy(d.meals, ',') : d.originalMeals
    if (meals.length > 0) day.meals = meals
    const accommodation = d.accommodation.trim()
    if (accommodation) day.accommodation = accommodation
    const festiveLabel = d.festiveLabel.trim()
    if (festiveLabel) day.festiveLabel = festiveLabel
    if (d.operatorLogo) day.operatorLogo = d.operatorLogo
    return day
  })
}

function buildFaqs(faqs: FaqDraft[]): CatalogFaq[] {
  return faqs.map((f) => {
    const href = f.href.trim()
    return {
      question: f.question.trim(),
      answer: f.answer.trim(),
      link: href ? { href, label: f.label.trim() } : null,
    }
  })
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  return a.every((v, i) => v === b[i])
}

function logoEqual(a?: CatalogOperatorLogoView, b?: CatalogOperatorLogoView): boolean {
  return (a?.src ?? '') === (b?.src ?? '') && (a?.alt ?? '') === (b?.alt ?? '')
}

function dayEqual(day: CatalogItineraryDayView, other: CatalogItineraryDayView): boolean {
  return (
    day.day === other.day &&
    day.title === other.title &&
    day.description === other.description &&
    arraysEqual(day.meals ?? [], other.meals ?? []) &&
    (day.accommodation ?? '') === (other.accommodation ?? '') &&
    (day.festiveLabel ?? '') === (other.festiveLabel ?? '') &&
    logoEqual(day.operatorLogo, other.operatorLogo)
  )
}

function itineraryEqual(a: CatalogItineraryDayView[], b: CatalogItineraryDayView[]): boolean {
  return a.length === b.length && a.every((day, i) => dayEqual(day, b[i]))
}

function faqsEqual(a: CatalogFaq[], b: CatalogFaq[]): boolean {
  if (a.length !== b.length) return false
  return a.every((faq, i) => {
    const other = b[i]
    return (
      faq.question === other.question &&
      faq.answer === other.answer &&
      (faq.link?.href ?? null) === (other.link?.href ?? null) &&
      (faq.link?.label ?? null) === (other.link?.label ?? null)
    )
  })
}

type Patch = Record<string, unknown>
type TextKey =
  | 'title'
  | 'durationText'
  | 'displayPriceText'
  | 'singleSupplement'
  | 'singleSupplementNote'
  | 'shortDescription'
  | 'metaTitle'
  | 'metaDescription'
  | 'quickAnswer'
  | 'reviewSummary'
type LinesKey = 'highlights' | 'inclusions' | 'exclusions' | 'tourCities'
type NumberKey = 'maxGroupSize' | 'rating' | 'reviewCount'
type FlagKey = 'isActive' | 'soldOut' | 'managesDepartures'

const TEXT_KEYS: TextKey[] = [
  'title',
  'durationText',
  'displayPriceText',
  'singleSupplement',
  'singleSupplementNote',
  'shortDescription',
  'metaTitle',
  'metaDescription',
  'quickAnswer',
  'reviewSummary',
]
const LINES_KEYS: LinesKey[] = ['highlights', 'inclusions', 'exclusions', 'tourCities']
const NUMBER_KEYS: NumberKey[] = ['maxGroupSize', 'rating', 'reviewCount']
const FLAG_KEYS: FlagKey[] = ['isActive', 'soldOut', 'managesDepartures']

function buildScalarPatch(form: FormState, tour: CatalogTourView, touched: Set<string>): Patch {
  const patch: Patch = {}
  if (touched.has('name')) {
    const name = form.name.trim()
    if (name !== (tour.name ?? '')) patch.name = name
  }
  for (const key of TEXT_KEYS) {
    const next = nullableText(form[key])
    if (touched.has(key) && next !== (tour[key] ?? null)) patch[key] = next
  }
  for (const key of NUMBER_KEYS) {
    const next = nullableNumber(form[key])
    if (touched.has(key) && next !== (tour[key] ?? null)) patch[key] = next
  }
  for (const key of FLAG_KEYS) {
    if (touched.has(key) && form[key] !== (tour[key] === true)) patch[key] = form[key]
  }
  return patch
}

function buildListPatch(form: FormState, tour: CatalogTourView, touched: Set<string>): Patch {
  const patch: Patch = {}
  for (const key of LINES_KEYS) {
    const next = splitBy(form[key], '\n')
    if (touched.has(key) && !arraysEqual(next, tour[key] ?? [])) patch[key] = next
  }
  if (touched.has('itinerary')) {
    const itinerary = buildItinerary(form.days)
    if (!itineraryEqual(itinerary, tour.itinerary ?? [])) patch.itinerary = itinerary
  }
  if (touched.has('heroImage') && form.heroImage !== (tour.heroImage ?? null))
    patch.heroImage = form.heroImage
  if (touched.has('gallery') && !arraysEqual(form.gallery, tour.gallery ?? []))
    patch.gallery = form.gallery
  if (touched.has('tags') && !arraysEqual(form.tags, tour.tags ?? [])) patch.tags = form.tags
  if (touched.has('faqs')) {
    const faqs = buildFaqs(form.faqs)
    if (!faqsEqual(faqs, tour.faqs ?? [])) patch.faqs = faqs
  }
  return patch
}

/** Only keys the person touched AND whose value really differs from the tour: nothing else is sent. */
export function buildPatch(form: FormState, tour: CatalogTourView, touched: Set<string>): Patch {
  return { ...buildScalarPatch(form, tour, touched), ...buildListPatch(form, tour, touched) }
}

export function durationDays(text: string): number | null {
  const match = text.match(/\d+/)
  if (!match) return null
  const n = Number(match[0])
  return Number.isFinite(n) ? n : null
}

export const SITE_ONLY_TEXT = '这一项只有 Magic Engine 团队可以改'

const ERROR_MESSAGES: Record<string, string> = {
  conflict: '这个团刚被别人改过，请刷新页面后再改',
  not_found: '找不到这条记录，可能已被删除，请刷新',
  invalid_fields: '有几项填得不对，请看红字提示',
  save_failed: '保存失败，请稍后重试',
  duplicate_departure: '这一天已经有班期了',
}

export const IMAGE_ERROR_TEXT =
  '图片地址不符合要求：要么是站内 /images/ 下的图片，要么来自已允许的图片来源'
export const UNKNOWN_FIELD_ERROR_TEXT = '这一项填得不对，请检查'

const FIELD_ERROR_MESSAGES: Record<string, string> = {
  required: '必填',
  too_long: '太长了',
  invalid_type: '格式不对',
  item_too_long: '某一条太长了',
  too_many_items: '条数太多',
  invalid_number: '要填 1 到 500 的整数',
  invalid_date: '日期要写成 2027-05-13 这样',
  return_before_depart: '返程不能早于出团',
  duplicate_day: '行程天数有重复',
  non_consecutive_days: '行程天数要从第 1 天开始连续',
  invalid_status: '状态不对',
  invalid_image_url: IMAGE_ERROR_TEXT,
  image_not_allowed: IMAGE_ERROR_TEXT,
  image_host_not_allowed: IMAGE_ERROR_TEXT,
  duplicate_tag: '这个标签已经有了',
  invalid_characters: '这里不能出现 < 或 >',
  invalid_link: '链接要写成站内路径，例如 /tours/china-highlights',
  invalid_tag: '标签写法不对，或者有重复',
  invalid_rating: '评分要填 0 到 5，最多一位小数',
}

const PRICE_ERROR_MESSAGE =
  '价格写法不对，要写成 From NZD $4,999 per person 这样，或写 TBC 表示待定'

/** The same code means a different range on these fields. */
const NUMBER_ERROR_BY_FIELD: Record<string, string> = {
  rating: '评分要填 0 到 5，最多一位小数',
  reviewCount: '评价数要填不小于 0 的整数',
}

function fieldErrorMessage(field: string, code: string): string {
  if (code.startsWith('invalid_price')) return PRICE_ERROR_MESSAGE
  if (code === 'invalid_number' && NUMBER_ERROR_BY_FIELD[field]) return NUMBER_ERROR_BY_FIELD[field]
  return FIELD_ERROR_MESSAGES[code] ?? UNKNOWN_FIELD_ERROR_TEXT
}

/** One sentence for a refused save; 403 means a field only Magic Engine may change. */
export function serverErrorMessage(code: string, status?: number): string {
  if (status === 403) return SITE_ONLY_TEXT
  return ERROR_MESSAGES[code] ?? ERROR_MESSAGES.save_failed
}

export function parseFieldErrors(fields: unknown): FieldErrors {
  const result: FieldErrors = {}
  if (!Array.isArray(fields)) return result
  for (const entry of fields) {
    if (entry && typeof entry === 'object') {
      const f = entry as { field?: unknown; code?: unknown }
      if (typeof f.field === 'string' && typeof f.code === 'string') {
        result[f.field] = fieldErrorMessage(f.field, f.code)
      }
    }
  }
  return result
}
