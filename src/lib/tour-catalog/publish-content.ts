/**
 * Content-column diff rows for the publish preview: itinerary, gallery, FAQs and site extras.
 * Split from publish.ts (file-size limit); pure. Every row is built with makeChange so the
 * before/after rendering matches the rest of the comparison table.
 * Design: docs/specs/2026-10-09-cts-tour-catalog-in-me-design-v0.3.md §6.8.1 / §6.11.1
 */

import type { CatalogFaq } from './catalog-contract'
import type { CatalogItineraryDay } from './types'
import type { PublishChange, PublishRisk } from './publish-contract'
import { arraysEqual, makeChange, type ProjectedTour } from './publish-projection'
import { stableStringify } from './store'

// ---------------------------------------------------------------------------
// itinerary
// ---------------------------------------------------------------------------

function mealsOf(day: CatalogItineraryDay): string[] {
  return day.meals === undefined ? [] : day.meals
}

function bodiesEqual(a: CatalogItineraryDay, b: CatalogItineraryDay): boolean {
  return (
    a.day === b.day &&
    a.title === b.title &&
    a.description === b.description &&
    arraysEqual(mealsOf(a), mealsOf(b)) &&
    a.accommodation === b.accommodation &&
    a.festiveLabel === b.festiveLabel
  )
}

function renderDay(day: CatalogItineraryDay | undefined): string | null {
  if (day === undefined) {
    return null
  }
  let text = `第 ${day.day} 天｜${day.title}｜${day.description}`
  const meals = mealsOf(day)
  if (meals.length > 0) {
    text = `${text}｜餐：${meals.join('/')}`
  }
  if (day.accommodation !== undefined) {
    text = `${text}｜住宿：${day.accommodation}`
  }
  if (day.festiveLabel !== undefined) {
    text = `${text}｜节日标记：${day.festiveLabel}`
  }
  return text
}

function renderLogo(day: CatalogItineraryDay | undefined): string | null {
  if (day === undefined || day.operatorLogo === undefined) {
    return null
  }
  return `${day.operatorLogo.src}（${day.operatorLogo.alt}）`
}

function logosEqual(a: CatalogItineraryDay | undefined, b: CatalogItineraryDay | undefined): boolean {
  return renderLogo(a) === renderLogo(b)
}

function dayBodyChange(
  beforeDay: CatalogItineraryDay | undefined,
  afterDay: CatalogItineraryDay | undefined,
  tourId: string,
  tourName: string,
  index: number,
): PublishChange {
  return makeChange(
    { kind: 'tour_field', tourId, tourName, field: 'itinerary', fieldLabel: `行程 第 ${index + 1} 天`, risk: 'normal' },
    renderDay(beforeDay),
    renderDay(afterDay),
  )
}

function dayLogoChange(
  beforeDay: CatalogItineraryDay | undefined,
  afterDay: CatalogItineraryDay | undefined,
  tourId: string,
  tourName: string,
  index: number,
): PublishChange {
  return makeChange(
    {
      kind: 'tour_field',
      tourId,
      tourName,
      field: 'itinerary',
      fieldLabel: `行程 第 ${index + 1} 天 航司标志`,
      risk: 'high',
    },
    renderLogo(beforeDay),
    renderLogo(afterDay),
  )
}

export function itineraryChanges(
  published: ProjectedTour,
  draft: ProjectedTour,
  tourId: string,
  tourName: string,
): PublishChange[] {
  const changes: PublishChange[] = []
  const length = Math.max(published.itinerary.length, draft.itinerary.length)
  for (let i = 0; i < length; i += 1) {
    const beforeDay = published.itinerary[i]
    const afterDay = draft.itinerary[i]
    const bodySame = beforeDay !== undefined && afterDay !== undefined && bodiesEqual(beforeDay, afterDay)
    if (!bodySame) {
      changes.push(dayBodyChange(beforeDay, afterDay, tourId, tourName, i))
    }
    if (!logosEqual(beforeDay, afterDay)) {
      changes.push(dayLogoChange(beforeDay, afterDay, tourId, tourName, i))
    }
  }
  return changes
}

// ---------------------------------------------------------------------------
// gallery
// ---------------------------------------------------------------------------

function tailOf(address: string): string {
  const withoutQuery = address.split('?')[0].split('#')[0]
  const slash = withoutQuery.lastIndexOf('/')
  const tail = slash === -1 ? withoutQuery : withoutQuery.slice(slash + 1)
  return tail === '' ? address : tail
}

function tailsOf(addresses: readonly string[]): string {
  return addresses.map(tailOf).join('、')
}

function onlyIn(source: readonly string[], other: readonly string[]): string[] {
  const set = new Set(other)
  return source.filter((item) => !set.has(item))
}

function commonIn(source: readonly string[], other: readonly string[]): string[] {
  const set = new Set(other)
  return source.filter((item) => set.has(item))
}

function galleryRow(
  fieldLabel: string,
  before: string,
  after: string,
  tourId: string,
  tourName: string,
): PublishChange {
  return makeChange(
    { kind: 'tour_field', tourId, tourName, field: 'gallery', fieldLabel, risk: 'normal' },
    before,
    after,
  )
}

export function galleryChanges(
  published: ProjectedTour,
  draft: ProjectedTour,
  tourId: string,
  tourName: string,
): PublishChange[] {
  const changes: PublishChange[] = []
  const added = onlyIn(draft.gallery, published.gallery)
  const removed = onlyIn(published.gallery, draft.gallery)
  if (added.length > 0) {
    changes.push(
      galleryRow(
        '图集：新增',
        `共 ${published.gallery.length} 张`,
        `共 ${draft.gallery.length} 张：${tailsOf(added)}`,
        tourId,
        tourName,
      ),
    )
  }
  if (removed.length > 0) {
    changes.push(
      galleryRow(
        '图集：移除',
        `共 ${published.gallery.length} 张：${tailsOf(removed)}`,
        `共 ${draft.gallery.length} 张`,
        tourId,
        tourName,
      ),
    )
  }
  const commonPublished = commonIn(published.gallery, draft.gallery)
  const commonDraft = commonIn(draft.gallery, published.gallery)
  if (!arraysEqual(commonPublished, commonDraft)) {
    changes.push(
      galleryRow('图集：顺序变化', tailsOf(commonPublished), tailsOf(commonDraft), tourId, tourName),
    )
  }
  return changes
}

// ---------------------------------------------------------------------------
// faqs
// ---------------------------------------------------------------------------

function renderFaq(faq: CatalogFaq): string {
  const base = `答：${faq.answer}`
  if (faq.link === null) {
    return base
  }
  return `${base}｜链接：${faq.link.label} → ${faq.link.href}`
}

function faqLabel(question: string): string {
  return `常见问题：${question.slice(0, 30)}`
}

function linksEqual(a: CatalogFaq, b: CatalogFaq): boolean {
  if (a.link === null || b.link === null) {
    return a.link === b.link
  }
  return a.link.href === b.link.href && a.link.label === b.link.label
}

function faqsEqual(a: CatalogFaq, b: CatalogFaq): boolean {
  return a.answer === b.answer && linksEqual(a, b)
}

function faqRow(
  fieldLabel: string,
  before: string | null,
  after: string | null,
  risk: PublishRisk,
  tourId: string,
  tourName: string,
): PublishChange {
  return makeChange(
    { kind: 'tour_field', tourId, tourName, field: 'faqs', fieldLabel, risk },
    before,
    after,
  )
}

function firstByQuestion(faqs: readonly CatalogFaq[]): Map<string, CatalogFaq> {
  const map = new Map<string, CatalogFaq>()
  for (const faq of faqs) {
    if (!map.has(faq.question)) {
      map.set(faq.question, faq)
    }
  }
  return map
}

function modifiedFaqRows(
  published: ProjectedTour,
  draft: ProjectedTour,
  tourId: string,
  tourName: string,
): PublishChange[] {
  const before = firstByQuestion(published.faqs)
  const rows: PublishChange[] = []
  for (const faq of draft.faqs) {
    const old = before.get(faq.question)
    if (old === undefined || faqsEqual(old, faq)) {
      continue
    }
    const risk: PublishRisk = linksEqual(old, faq) ? 'normal' : 'high'
    rows.push(faqRow(faqLabel(faq.question), renderFaq(old), renderFaq(faq), risk, tourId, tourName))
  }
  return rows
}

function addedFaqRows(
  published: ProjectedTour,
  draft: ProjectedTour,
  tourId: string,
  tourName: string,
): PublishChange[] {
  const before = firstByQuestion(published.faqs)
  const rows: PublishChange[] = []
  for (const faq of draft.faqs) {
    if (before.has(faq.question)) {
      continue
    }
    const risk: PublishRisk = faq.link === null ? 'normal' : 'high'
    rows.push(faqRow(faqLabel(faq.question), null, renderFaq(faq), risk, tourId, tourName))
  }
  return rows
}

function removedFaqRows(
  published: ProjectedTour,
  draft: ProjectedTour,
  tourId: string,
  tourName: string,
): PublishChange[] {
  const after = firstByQuestion(draft.faqs)
  const rows: PublishChange[] = []
  for (const faq of published.faqs) {
    if (after.has(faq.question)) {
      continue
    }
    const risk: PublishRisk = faq.link === null ? 'normal' : 'high'
    rows.push(faqRow(faqLabel(faq.question), renderFaq(faq), null, risk, tourId, tourName))
  }
  return rows
}

function faqOrderRow(
  published: ProjectedTour,
  draft: ProjectedTour,
  tourId: string,
  tourName: string,
): PublishChange[] {
  const before = published.faqs.map((faq) => faq.question).join('；')
  const after = draft.faqs.map((faq) => faq.question).join('；')
  if (before !== after) {
    return [faqRow('常见问题：顺序变化', before, after, 'normal', tourId, tourName)]
  }
  // Same questions in the same order and nothing matched above, yet the lists differ: two FAQs
  // share a question and the later one changed. Never let a difference go without a row.
  const beforeAll = published.faqs.map(renderFaq).join('；')
  const afterAll = draft.faqs.map(renderFaq).join('；')
  if (beforeAll === afterAll) {
    return []
  }
  return [faqRow('常见问题', beforeAll, afterAll, 'high', tourId, tourName)]
}

export function faqChanges(
  published: ProjectedTour,
  draft: ProjectedTour,
  tourId: string,
  tourName: string,
): PublishChange[] {
  const modified = modifiedFaqRows(published, draft, tourId, tourName)
  const added = addedFaqRows(published, draft, tourId, tourName)
  const removed = removedFaqRows(published, draft, tourId, tourName)
  const changes = [...modified, ...added, ...removed]
  if (changes.length > 0) {
    return changes
  }
  return faqOrderRow(published, draft, tourId, tourName)
}

// ---------------------------------------------------------------------------
// site extras
// ---------------------------------------------------------------------------

export function siteExtrasChanges(
  published: ProjectedTour,
  draft: ProjectedTour,
  tourId: string,
  tourName: string,
): PublishChange[] {
  const before = stableStringify(published.siteExtras)
  const after = stableStringify(draft.siteExtras)
  if (before === after) {
    return []
  }
  return [
    makeChange(
      { kind: 'tour_field', tourId, tourName, field: 'siteExtras', fieldLabel: '站点附加信息', risk: 'normal' },
      before,
      after,
    ),
  ]
}

// ---------------------------------------------------------------------------
// combined
// ---------------------------------------------------------------------------

/** galleryChanges, then faqChanges, then siteExtrasChanges. */
export function contentChanges(
  published: ProjectedTour,
  draft: ProjectedTour,
  tourId: string,
  tourName: string,
): PublishChange[] {
  return [
    ...galleryChanges(published, draft, tourId, tourName),
    ...faqChanges(published, draft, tourId, tourName),
    ...siteExtrasChanges(published, draft, tourId, tourName),
  ]
}
