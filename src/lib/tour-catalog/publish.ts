/**
 * Pure comparison logic for publishing the tour catalog.
 * Design: docs/specs/2026-10-09-cts-tour-catalog-in-me-design-v0.3.md §6.8.1
 */

import { createHash } from 'node:crypto'
import { asRecord, mapDepartureRow, mapTourRow, stableStringify } from './store'
import { DEPARTURE_STATUSES, type CatalogDeparture, type CatalogItineraryDay, type CatalogTour, type DepartureStatus } from './types'
import { STATUS_LABELS } from './departures-csv'
import { toFirstPartyTours } from './output'
import { isValidIsoDate } from './dates'
import type { KeptStatusRow, PublishChange, PublishRisk, SellableCheck } from './publish-contract'

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

export interface CatalogDiff {
  changes: PublishChange[]
  changedTourIds: string[]
  highRiskCount: number
  sellable: SellableCheck
}

// ---------------------------------------------------------------------------
// parsePublishedSnapshot
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isKnownStatus(value: unknown): value is DepartureStatus {
  return typeof value === 'string' && (DEPARTURE_STATUSES as readonly string[]).includes(value)
}

/**
 * Strict: a tour whose identity or sale switches cannot be read is dropped (and logged), never
 * defaulted — a missing `is_active` / `manages_departures` must not silently become false.
 */
function parseSnapshotTour(item: unknown): CatalogTour | null {
  if (!isPlainObject(item)) {
    console.error('tour_catalog_snapshot_tour_dropped', { reason: 'not_an_object' })
    return null
  }
  if (typeof item.id !== 'string' || item.id === '') {
    console.error('tour_catalog_snapshot_tour_dropped', { reason: 'bad_id' })
    return null
  }
  if (typeof item.is_active !== 'boolean' || typeof item.manages_departures !== 'boolean') {
    console.error('tour_catalog_snapshot_tour_dropped', { reason: 'bad_flags', tourId: item.id })
    return null
  }
  return mapTourRow(item)
}

function parseSnapshotDeparture(item: unknown, tourIds: ReadonlySet<string>): CatalogDeparture | null {
  if (!isPlainObject(item)) {
    return null
  }
  if (!isKnownStatus(item.status)) {
    return null
  }
  if (typeof item.depart_on !== 'string' || !isValidIsoDate(item.depart_on)) {
    return null
  }
  // A departure whose tour was dropped (or never existed) goes with it.
  if (typeof item.tour_id !== 'string' || !tourIds.has(item.tour_id)) {
    return null
  }
  const mapped = mapDepartureRow(item)
  return { ...mapped, internal: {} }
}

/** Parse the jsonb snapshot written by the database into catalog content. */
export function parsePublishedSnapshot(raw: unknown): CatalogContent | null {
  if (!isPlainObject(raw)) {
    return null
  }
  if (raw.schema_version !== 1) {
    return null
  }
  if (!Array.isArray(raw.tours) || !Array.isArray(raw.departures)) {
    return null
  }
  const tours: CatalogTour[] = []
  for (const item of raw.tours) {
    const tour = parseSnapshotTour(item)
    if (tour !== null) {
      tours.push(tour)
    }
  }
  const tourIds = new Set(tours.map((tour) => tour.id))
  const departures: CatalogDeparture[] = []
  for (const item of raw.departures) {
    const departure = parseSnapshotDeparture(item, tourIds)
    if (departure !== null) {
      departures.push(departure)
    }
  }
  return { tours, departures }
}

// ---------------------------------------------------------------------------
// projectCatalog
// ---------------------------------------------------------------------------

function projectItineraryDay(day: CatalogItineraryDay): CatalogItineraryDay {
  const copy: CatalogItineraryDay = {
    day: day.day,
    title: day.title,
    description: day.description,
  }
  if (day.meals !== undefined) {
    copy.meals = [...day.meals]
  }
  return copy
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
// diffCatalog — helpers
// ---------------------------------------------------------------------------

const MAX_RENDER = 200
const CONTEXT_BEFORE = 40
const ELLIPSIS = '…'

interface FieldSpec {
  field: keyof ProjectedTour
  fieldLabel: string
  risk: PublishRisk
}

const TOUR_FIELD_SPECS: readonly FieldSpec[] = [
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

function renderField(field: keyof ProjectedTour, value: unknown): string | null {
  if (field === 'managesDepartures') {
    return value === true ? '是' : '否'
  }
  if (Array.isArray(value)) {
    const items = value.filter((item): item is string => typeof item === 'string')
    return items.join('；')
  }
  return renderScalar(value)
}

function arraysEqual(a: readonly string[], b: readonly string[]): boolean {
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

function fieldValuesEqual(a: unknown, b: unknown): boolean {
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
function renderPair(before: string | null, after: string | null): { before: string | null; after: string | null } {
  const beforeLength = before === null ? 0 : before.length
  const afterLength = after === null ? 0 : after.length
  if (beforeLength <= MAX_RENDER && afterLength <= MAX_RENDER) {
    return { before, after }
  }
  const diffAt = before === null || after === null ? 0 : firstDifference(before, after)
  const start = Math.max(0, diffAt - CONTEXT_BEFORE)
  return { before: windowAt(before, start), after: windowAt(after, start) }
}

function makeChange(
  partial: Omit<PublishChange, 'before' | 'after'>,
  before: string | null,
  after: string | null,
): PublishChange {
  return { ...partial, ...renderPair(before, after) }
}

function tourFieldChanges(
  published: ProjectedTour,
  draft: ProjectedTour,
  tourId: string,
  tourName: string,
): PublishChange[] {
  const changes: PublishChange[] = []
  for (const spec of TOUR_FIELD_SPECS) {
    const beforeValue = published[spec.field]
    const afterValue = draft[spec.field]
    if (fieldValuesEqual(beforeValue, afterValue)) {
      continue
    }
    changes.push(
      makeChange(
        { kind: 'tour_field', tourId, tourName, field: spec.field, fieldLabel: spec.fieldLabel, risk: spec.risk },
        renderField(spec.field, beforeValue),
        renderField(spec.field, afterValue),
      ),
    )
  }
  return changes
}

// ---------------------------------------------------------------------------
// diffCatalog — itinerary
// ---------------------------------------------------------------------------

function mealsOf(day: CatalogItineraryDay): string[] {
  return day.meals === undefined ? [] : day.meals
}

function daysEqual(a: CatalogItineraryDay, b: CatalogItineraryDay): boolean {
  return a.day === b.day && a.title === b.title && a.description === b.description && arraysEqual(mealsOf(a), mealsOf(b))
}

function renderDay(day: CatalogItineraryDay | undefined): string | null {
  if (day === undefined) {
    return null
  }
  const base = `第 ${day.day} 天｜${day.title}｜${day.description}`
  const meals = mealsOf(day)
  return meals.length > 0 ? `${base}｜餐：${meals.join('/')}` : base
}

function itineraryChanges(
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
    if (beforeDay !== undefined && afterDay !== undefined && daysEqual(beforeDay, afterDay)) {
      continue
    }
    changes.push(
      makeChange(
        { kind: 'tour_field', tourId, tourName, field: 'itinerary', fieldLabel: `行程 第 ${i + 1} 天`, risk: 'normal' },
        renderDay(beforeDay),
        renderDay(afterDay),
      ),
    )
  }
  return changes
}

// ---------------------------------------------------------------------------
// diffCatalog — departures
// ---------------------------------------------------------------------------

function compareDepartOn(a: ProjectedDeparture, b: ProjectedDeparture): number {
  if (a.departOn < b.departOn) return -1
  if (a.departOn > b.departOn) return 1
  return 0
}

function departureLabel(departure: ProjectedDeparture): string {
  return `${departure.departOn}（${STATUS_LABELS[departure.status]}）`
}

/** Label for a departure that is new outward: date, status and its own price when it has one. */
function addedDepartureLabel(departure: ProjectedDeparture): string {
  const status = STATUS_LABELS[departure.status]
  const price = departure.priceTextOverride
  if (price === null || price === '') {
    return `${departure.departOn}（${status}）`
  }
  return `${departure.departOn}（${status}，${price}）`
}

function addedDepartureChange(departure: ProjectedDeparture, tourId: string, tourName: string): PublishChange {
  return makeChange(
    { kind: 'departure_added', tourId, tourName, departOn: departure.departOn, fieldLabel: '新增班期', risk: 'high' },
    null,
    addedDepartureLabel(departure),
  )
}

function departureFieldChanges(
  published: ProjectedDeparture,
  draft: ProjectedDeparture,
  tourId: string,
  tourName: string,
): PublishChange[] {
  const changes: PublishChange[] = []
  if (published.status !== draft.status) {
    changes.push(
      makeChange(
        { kind: 'departure_field', tourId, tourName, departOn: draft.departOn, field: 'status', fieldLabel: '班期状态', risk: 'high' },
        STATUS_LABELS[published.status],
        STATUS_LABELS[draft.status],
      ),
    )
  }
  if (published.priceTextOverride !== draft.priceTextOverride) {
    changes.push(
      makeChange(
        { kind: 'departure_field', tourId, tourName, departOn: draft.departOn, field: 'priceTextOverride', fieldLabel: '班期单独价', risk: 'high' },
        published.priceTextOverride,
        draft.priceTextOverride,
      ),
    )
  }
  if (published.departOn !== draft.departOn) {
    changes.push(
      makeChange(
        { kind: 'departure_field', tourId, tourName, departOn: draft.departOn, field: 'departOn', fieldLabel: '出发日期', risk: 'high' },
        published.departOn,
        draft.departOn,
      ),
    )
  }
  if (published.returnOn !== draft.returnOn) {
    changes.push(
      makeChange(
        { kind: 'departure_field', tourId, tourName, departOn: draft.departOn, field: 'returnOn', fieldLabel: '返程日期', risk: 'normal' },
        published.returnOn,
        draft.returnOn,
      ),
    )
  }
  return changes
}

function departureChanges(
  published: ProjectedDeparture[],
  draft: ProjectedDeparture[],
  tourId: string,
  tourName: string,
): PublishChange[] {
  const publishedById = new Map(published.map((d) => [d.id, d]))
  const draftById = new Map(draft.map((d) => [d.id, d]))
  const changes: PublishChange[] = []

  const added = draft.filter((d) => !publishedById.has(d.id)).sort(compareDepartOn)
  for (const departure of added) {
    changes.push(addedDepartureChange(departure, tourId, tourName))
  }

  const removed = published.filter((d) => !draftById.has(d.id)).sort(compareDepartOn)
  for (const departure of removed) {
    changes.push(
      makeChange(
        { kind: 'departure_removed', tourId, tourName, departOn: departure.departOn, fieldLabel: '移除班期', risk: 'high' },
        departureLabel(departure),
        null,
      ),
    )
  }

  const shared = draft.filter((d) => publishedById.has(d.id)).sort(compareDepartOn)
  for (const departure of shared) {
    const before = publishedById.get(departure.id)
    if (before === undefined) {
      continue
    }
    changes.push(...departureFieldChanges(before, departure, tourId, tourName))
  }

  return changes
}

// ---------------------------------------------------------------------------
// diffCatalog — sellable
// ---------------------------------------------------------------------------

function sellableIds(content: CatalogContent, today: string): Set<string> {
  const feed = toFirstPartyTours(content.tours, content.departures, today)
  const ids = new Set<string>()
  for (const tour of feed) {
    if (tour.is_active) {
      ids.add(tour.id)
    }
  }
  return ids
}

function sellableFlipChange(
  publishedSellable: Set<string>,
  draftSellable: Set<string>,
  tourId: string,
  tourName: string,
): PublishChange | null {
  const before = publishedSellable.has(tourId)
  const after = draftSellable.has(tourId)
  if (before === after) {
    return null
  }
  return makeChange(
    { kind: 'sellable_flip', tourId, tourName, fieldLabel: '对外是否可售', risk: 'high' },
    before ? '可售' : '不可售',
    after ? '可售' : '不可售',
  )
}

function buildSellableCheck(before: number, after: number): SellableCheck {
  return { before, after, needsCountConfirm: after === 0 || after < before * 0.7 }
}

// ---------------------------------------------------------------------------
// diffCatalog
// ---------------------------------------------------------------------------

function compareTourOrder(a: ProjectedTour, b: ProjectedTour): number {
  if (a.sortOrder !== b.sortOrder) {
    return a.sortOrder - b.sortOrder
  }
  return a.name.localeCompare(b.name)
}

function orderedTours(published: ProjectedTour[], draft: ProjectedTour[]): ProjectedTour[] {
  const draftIds = new Set(draft.map((t) => t.id))
  const publishedIds = new Set(published.map((t) => t.id))
  const draftOnly = draft.filter((t) => !publishedIds.has(t.id)).sort(compareTourOrder)
  const shared = draft.filter((t) => publishedIds.has(t.id)).sort(compareTourOrder)
  const publishedOnly = published.filter((t) => !draftIds.has(t.id)).sort(compareTourOrder)
  return [...shared, ...draftOnly, ...publishedOnly]
}

const ADDED_TOUR_PRICE_SPECS: ReadonlyArray<{ field: 'displayPriceText' | 'singleSupplement'; fieldLabel: string }> = [
  { field: 'displayPriceText', fieldLabel: '展示价' },
  { field: 'singleSupplement', fieldLabel: '单房差' },
]

/** A new tour is spelled out: the tour itself, its prices, and every departure it brings. */
function addedTourChanges(draftTour: ProjectedTour, draftDepartures: ProjectedDeparture[]): PublishChange[] {
  const tourId = draftTour.id
  const tourName = draftTour.name
  const changes: PublishChange[] = [
    makeChange({ kind: 'tour_added', tourId, tourName, fieldLabel: '新增团', risk: 'high' }, null, draftTour.name),
  ]
  for (const spec of ADDED_TOUR_PRICE_SPECS) {
    const value = draftTour[spec.field]
    if (value === null || value === '') {
      continue
    }
    changes.push(
      makeChange({ kind: 'tour_field', tourId, tourName, field: spec.field, fieldLabel: spec.fieldLabel, risk: 'high' }, null, value),
    )
  }
  for (const departure of [...draftDepartures].sort(compareDepartOn)) {
    changes.push(addedDepartureChange(departure, tourId, tourName))
  }
  return changes
}

function diffOneTour(
  tourId: string,
  publishedTour: ProjectedTour | undefined,
  draftTour: ProjectedTour | undefined,
  publishedDepartures: ProjectedDeparture[],
  draftDepartures: ProjectedDeparture[],
  publishedSellable: Set<string>,
  draftSellable: Set<string>,
): PublishChange[] {
  const tourName = draftTour !== undefined ? draftTour.name : publishedTour === undefined ? '' : publishedTour.name

  if (publishedTour === undefined && draftTour !== undefined) {
    return addedTourChanges(draftTour, draftDepartures)
  }
  if (draftTour === undefined && publishedTour !== undefined) {
    return [
      makeChange(
        { kind: 'tour_removed', tourId, tourName, fieldLabel: '移除团', risk: 'high' },
        publishedTour.name,
        null,
      ),
    ]
  }
  if (publishedTour === undefined || draftTour === undefined) {
    return []
  }

  const changes: PublishChange[] = []
  changes.push(...tourFieldChanges(publishedTour, draftTour, tourId, tourName))
  changes.push(...itineraryChanges(publishedTour, draftTour, tourId, tourName))
  changes.push(...departureChanges(publishedDepartures, draftDepartures, tourId, tourName))
  const flip = sellableFlipChange(publishedSellable, draftSellable, tourId, tourName)
  if (flip !== null) {
    changes.push(flip)
  }
  return changes
}

function uniqueTourIds(changes: PublishChange[]): string[] {
  const seen = new Set<string>()
  const ids: string[] = []
  for (const change of changes) {
    if (!seen.has(change.tourId)) {
      seen.add(change.tourId)
      ids.push(change.tourId)
    }
  }
  return ids
}

function countHighRisk(changes: PublishChange[]): number {
  return changes.filter((change) => change.risk === 'high').length
}

/** Compare published content against the draft and describe every outward-facing change. */
export function diffCatalog(
  published: CatalogContent | null,
  draft: CatalogContent,
  today: string,
): CatalogDiff {
  const draftProjection = projectCatalog(draft)
  const draftSellable = sellableIds(draft, today)

  if (published === null) {
    return {
      changes: [],
      changedTourIds: [],
      highRiskCount: 0,
      sellable: buildSellableCheck(0, draftSellable.size),
    }
  }

  const publishedProjection = projectCatalog(published)
  const publishedSellable = sellableIds(published, today)

  const publishedToursById = new Map(publishedProjection.tours.map((t) => [t.id, t]))
  const draftToursById = new Map(draftProjection.tours.map((t) => [t.id, t]))
  const ordered = orderedTours(publishedProjection.tours, draftProjection.tours)

  const changes: PublishChange[] = []
  for (const tour of ordered) {
    changes.push(
      ...diffOneTour(
        tour.id,
        publishedToursById.get(tour.id),
        draftToursById.get(tour.id),
        publishedProjection.departures.filter((d) => d.tourId === tour.id),
        draftProjection.departures.filter((d) => d.tourId === tour.id),
        publishedSellable,
        draftSellable,
      ),
    )
  }

  return {
    changes,
    changedTourIds: uniqueTourIds(changes),
    highRiskCount: countHighRisk(changes),
    sellable: buildSellableCheck(publishedSellable.size, draftSellable.size),
  }
}

// ---------------------------------------------------------------------------
// computeDiffHash
// ---------------------------------------------------------------------------

export interface DiffHashInput {
  publishedVersion: number
  draftVersion: number
  publishedProjection: CatalogProjection | null
  draftProjection: CatalogProjection
  highRiskCount: number
  revertTargetVersion?: number
}

/** Deterministic sha256 hex over the versions, projections and risk count. */
export function computeDiffHash(input: DiffHashInput): string {
  const canonical = stableStringify({
    publishedVersion: input.publishedVersion,
    draftVersion: input.draftVersion,
    publishedProjection: input.publishedProjection,
    draftProjection: input.draftProjection,
    highRiskCount: input.highRiskCount,
    revertTargetVersion: input.revertTargetVersion ?? null,
  })
  return createHash('sha256').update(canonical).digest('hex')
}

// ---------------------------------------------------------------------------
// keepCurrentStatuses
// ---------------------------------------------------------------------------

function tourNameById(tours: CatalogTour[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const tour of tours) {
    map.set(tour.id, tour.name)
  }
  return map
}

export const REVERT_CLOSED_STATUS: DepartureStatus = 'closed'
export const REVERT_CLOSED_LABEL = '已关闭（现在对外已没有这个班期）'

function tourDateKey(departure: CatalogDeparture): string {
  return `${departure.tourId}|${departure.departOn}`
}

/** (tour, date) → current departure; on a duplicate the smallest id wins, as in the SQL. */
function indexByTourDate(departures: CatalogDeparture[]): Map<string, CatalogDeparture> {
  const map = new Map<string, CatalogDeparture>()
  for (const departure of departures) {
    const key = tourDateKey(departure)
    const existing = map.get(key)
    if (existing === undefined || departure.id < existing.id) {
      map.set(key, departure)
    }
  }
  return map
}

/**
 * Revert rule for departure statuses. MUST stay identical to the SQL function
 * `tour_catalog_revert_published`:
 *  1. match the target departure to what is published now by id, else by (tour, date) —
 *     undoing an import and importing again gives the same day a new id;
 *  2. matched → the CURRENT status stays (sold out / cancelled are facts);
 *  3. not matched either way → it comes back as `closed`, never bookable: a departure that
 *     was deleted or cancelled since must not reappear open.
 */
export function keepCurrentStatuses(
  target: CatalogContent,
  current: CatalogContent,
): { content: CatalogContent; kept: KeptStatusRow[] } {
  const currentById = new Map(current.departures.map((d) => [d.id, d]))
  const currentByTourDate = indexByTourDate(current.departures)
  const names = tourNameById(target.tours)
  const kept: KeptStatusRow[] = []

  const departures = target.departures.map((departure) => {
    const match = currentById.get(departure.id) ?? currentByTourDate.get(tourDateKey(departure))
    const status = match === undefined ? REVERT_CLOSED_STATUS : match.status
    if (status === departure.status) {
      return departure
    }
    kept.push({
      tourName: names.get(departure.tourId) ?? '',
      departOn: departure.departOn,
      currentStatus: match === undefined ? REVERT_CLOSED_LABEL : STATUS_LABELS[match.status],
      oldStatus: STATUS_LABELS[departure.status],
    })
    return { ...departure, status }
  })

  return { content: { tours: target.tours, departures }, kept }
}
