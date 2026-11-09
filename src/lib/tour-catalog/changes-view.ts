/**
 * Tour catalog — turning raw change-log rows into display-ready views.
 * Pure functions only: no I/O, no clock, no Supabase. Safe for client components.
 */

import type { ChangeLogEntry } from './store-edit'
import type {
  CatalogChangeView,
  CatalogRole,
  ChangeSource,
  PublishContributor,
} from './catalog-contract'
import { TOUR_FIELD_SPECS, renderField, type FieldSpec } from './publish'
import { STATUS_LABELS } from './departures-csv'
import type { CatalogDeparture, DepartureStatus } from './types'

export const ME_TEAM_LABEL = 'Magic Engine 团队'
export const SYSTEM_LABEL = '系统'
export const MAX_CHANGE_VIEWS = 100
export const MAX_SUMMARY_LENGTH = 200

const UUID_PATTERN = /^[0-9a-f-]{36}$/i
const ASSISTANT_SUFFIX = ' (AI 助手)'
const EDIT_BY_PREFIX = 'edit by '
const IMPORT_PREFIX = 'import:'
const ROLLBACK_PREFIX = 'rollback:'

/** Read a value as a string, returning '' for anything that is not a string. */
function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** Read a value as a record, returning null for anything that is not a plain object. */
function rec(value: unknown): Record<string, unknown> | null {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return null
}

/** Read a nested string field from a record, returning '' when absent. */
function fieldOf(row: Record<string, unknown> | null, key: string): string {
  if (row === null) {
    return ''
  }
  return str(row[key])
}

// ---------------------------------------------------------------------------
// Actor parsing
// ---------------------------------------------------------------------------

export interface ParsedActor {
  email: string | null
  source: ChangeSource
  batchId: string | null
}

const SYSTEM_ACTOR: ParsedActor = { email: null, source: 'system', batchId: null }

/** Normalise an identity string: trimmed and lower-cased; '' when empty. */
function normaliseEmail(raw: string): string {
  return raw.trim().toLowerCase()
}

/** Parse a `edit by X` / `edit by X (AI 助手)` body, or null when it does not match. */
function parseEditActor(raw: string): ParsedActor | null {
  if (!raw.startsWith(EDIT_BY_PREFIX)) {
    return null
  }
  const rest = raw.slice(EDIT_BY_PREFIX.length)
  if (rest.endsWith(ASSISTANT_SUFFIX)) {
    const email = normaliseEmail(rest.slice(0, rest.length - ASSISTANT_SUFFIX.length))
    if (email === '') {
      return null
    }
    return { email, source: 'assistant', batchId: null }
  }
  const email = normaliseEmail(rest)
  if (email === '') {
    return null
  }
  return { email, source: 'manual', batchId: null }
}

/** Parse a `import:<batchId> by X` / `rollback:<batchId> by X` body, or null. */
function parseBatchActor(raw: string, source: 'import' | 'rollback'): ParsedActor | null {
  const prefix = source === 'import' ? IMPORT_PREFIX : ROLLBACK_PREFIX
  if (!raw.startsWith(prefix)) {
    return null
  }
  const rest = raw.slice(prefix.length)
  const marker = ' by '
  const markerIndex = rest.indexOf(marker)
  if (markerIndex < 0) {
    return null
  }
  const batchId = rest.slice(0, markerIndex)
  if (!UUID_PATTERN.test(batchId)) {
    return null
  }
  const email = normaliseEmail(rest.slice(markerIndex + marker.length))
  if (email === '') {
    return null
  }
  return { email, source, batchId }
}

/** Parse the raw actor string written by the database into its parts. */
export function parseActor(raw: string): ParsedActor {
  const edit = parseEditActor(raw)
  if (edit !== null) {
    return edit
  }
  const imported = parseBatchActor(raw, 'import')
  if (imported !== null) {
    return imported
  }
  const rolledBack = parseBatchActor(raw, 'rollback')
  if (rolledBack !== null) {
    return rolledBack
  }
  return SYSTEM_ACTOR
}

// ---------------------------------------------------------------------------
// Actor labels
// ---------------------------------------------------------------------------

export type ActorLabeler = (email: string | null) => string

/** Build a labeler that hides Magic Engine staff emails from client editors. */
export function makeActorLabeler(
  viewerRole: CatalogRole,
  memberEmails: ReadonlySet<string>,
  /** The viewer always sees their own email, whether or not the access list still has it. */
  viewerEmail: string | null = null,
): ActorLabeler {
  return (email: string | null): string => {
    if (email === null) {
      return SYSTEM_LABEL
    }
    if (viewerRole === 'me_admin' || email === viewerEmail) {
      return email
    }
    return memberEmails.has(email) ? email : ME_TEAM_LABEL
  }
}

/** Rewrite a raw actor string for display, keeping its original shape. */
export function maskActorText(raw: string, label: ActorLabeler): string {
  const parsed = parseActor(raw)
  if (parsed.source === 'system' || parsed.email === null) {
    return SYSTEM_LABEL
  }
  const shown = label(parsed.email)
  if (parsed.source === 'assistant') {
    return `${EDIT_BY_PREFIX}${shown}${ASSISTANT_SUFFIX}`
  }
  if (parsed.source === 'manual') {
    return `${EDIT_BY_PREFIX}${shown}`
  }
  const prefix = parsed.source === 'import' ? IMPORT_PREFIX : ROLLBACK_PREFIX
  return `${prefix}${parsed.batchId} by ${shown}`
}

// ---------------------------------------------------------------------------
// Redaction
// ---------------------------------------------------------------------------

export const EDITOR_HIDDEN_KEYS: readonly string[] = ['internal', 'status_source', 'status_as_of']

/** Shallow-copy a row without the keys a client editor must not see. */
function redactRow(row: Record<string, unknown> | null): Record<string, unknown> | null {
  if (row === null) {
    return null
  }
  const copy: Record<string, unknown> = {}
  for (const key of Object.keys(row)) {
    if (EDITOR_HIDDEN_KEYS.includes(key)) {
      continue
    }
    copy[key] = row[key]
  }
  return copy
}

/**
 * The one place a departure row is trimmed for whoever is looking: operational `internal` facts
 * (airline, seat capacity, routes) reach Magic Engine admins only. Every response that carries a
 * departure — the catalog read and both save endpoints — goes through this.
 */
export function trimDepartureForViewer(role: CatalogRole, departure: CatalogDeparture): CatalogDeparture {
  if (role === 'me_admin') {
    return departure
  }
  return { ...departure, internal: {} }
}

/** Return a new entry with hidden keys removed and the actor masked. */
export function redactEntryForEditor(entry: ChangeLogEntry, label: ActorLabeler): ChangeLogEntry {
  return {
    id: entry.id,
    entity: entry.entity,
    entityId: entry.entityId,
    action: entry.action,
    before: redactRow(entry.before),
    after: redactRow(entry.after),
    actor: maskActorText(entry.actor, label),
    createdAt: entry.createdAt,
  }
}

// ---------------------------------------------------------------------------
// Contributors
// ---------------------------------------------------------------------------

/** Count changes per display label, newest-agnostic; sorted by count then label. */
export function summariseContributors(
  actors: readonly string[],
  label: ActorLabeler,
): PublishContributor[] {
  const counts = new Map<string, number>()
  for (const raw of actors) {
    const shown = label(parseActor(raw).email)
    counts.set(shown, (counts.get(shown) ?? 0) + 1)
  }
  const list: PublishContributor[] = []
  for (const [actorLabel, changes] of counts) {
    list.push({ actorLabel, changes })
  }
  list.sort((a, b) => {
    if (a.changes !== b.changes) {
      return b.changes - a.changes
    }
    if (a.actorLabel < b.actorLabel) {
      return -1
    }
    if (a.actorLabel > b.actorLabel) {
      return 1
    }
    return 0
  })
  return list
}

// ---------------------------------------------------------------------------
// Summaries
// ---------------------------------------------------------------------------

/** camelCase spec field → snake_case database column. */
const TOUR_COLUMNS: Record<string, string> = {
  name: 'name',
  title: 'title',
  displayPriceText: 'display_price_text',
  singleSupplement: 'single_supplement',
  isActive: 'is_active',
  managesDepartures: 'manages_departures',
  shortDescription: 'short_description',
  durationText: 'duration_text',
  highlights: 'highlights',
  inclusions: 'inclusions',
  exclusions: 'exclusions',
  tourCities: 'tour_cities',
  maxGroupSize: 'max_group_size',
  heroImage: 'hero_image',
  soldOut: 'sold_out',
  singleSupplementNote: 'single_supplement_note',
  rating: 'rating',
  reviewCount: 'review_count',
  reviewSummary: 'review_summary',
  metaTitle: 'meta_title',
  metaDescription: 'meta_description',
  tags: 'tags',
  quickAnswer: 'quick_answer',
}

/** List columns summarised by size only: column → [label, unit]. */
const COUNTED_COLUMNS: ReadonlyArray<[string, string, string]> = [
  ['gallery', '图集', '张'],
  ['faqs', '常见问题', '条'],
]

const EMPTY_LABEL = '（空）'
const MAX_RENDERED_LENGTH = 60

/** Render one field value for display, cutting long text and showing （空） for blanks. */
function renderValue(field: FieldSpec['field'], value: unknown): string {
  const rendered = renderField(field, value)
  if (rendered === null || rendered === '') {
    return EMPTY_LABEL
  }
  if (rendered.length > MAX_RENDERED_LENGTH) {
    return `${rendered.slice(0, MAX_RENDERED_LENGTH)}…`
  }
  return rendered
}

/** True when two raw values differ under JSON comparison. */
function changed(before: unknown, after: unknown): boolean {
  return JSON.stringify(before) !== JSON.stringify(after)
}

/** Length of an array value, or 0 when it is not an array. */
function arrayLength(value: unknown): number {
  return Array.isArray(value) ? value.length : 0
}

/** Summarise a tour update by diffing the editable columns. */
function summariseTourUpdate(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): string {
  const parts: string[] = []
  for (const spec of TOUR_FIELD_SPECS) {
    const column = TOUR_COLUMNS[spec.field]
    if (column === undefined) {
      continue
    }
    const oldValue = before === null ? undefined : before[column]
    const newValue = after === null ? undefined : after[column]
    if (!changed(oldValue, newValue)) {
      continue
    }
    parts.push(`${spec.fieldLabel}：${renderValue(spec.field, oldValue)} → ${renderValue(spec.field, newValue)}`)
  }
  const oldItinerary = before === null ? undefined : before.itinerary
  const newItinerary = after === null ? undefined : after.itinerary
  if (changed(oldItinerary, newItinerary)) {
    parts.push(`行程安排：已修改（${arrayLength(oldItinerary)} 天 → ${arrayLength(newItinerary)} 天）`)
  }
  for (const [column, label, unit] of COUNTED_COLUMNS) {
    const oldList = before === null ? undefined : before[column]
    const newList = after === null ? undefined : after[column]
    if (changed(oldList, newList)) {
      parts.push(`${label}：已修改（${arrayLength(oldList)} ${unit} → ${arrayLength(newList)} ${unit}）`)
    }
  }
  if (parts.length === 0) {
    return '已保存（内容没有变化）'
  }
  return parts.join('；')
}

/** Resolve a status cell to its Chinese label, falling back to the raw string. */
function statusLabel(value: unknown): string {
  const raw = str(value)
  if (raw === '') {
    return ''
  }
  const known = STATUS_LABELS[raw as DepartureStatus]
  return known === undefined ? raw : known
}

/** Summarise a departure insert. */
function summariseDepartureInsert(after: Record<string, unknown> | null): string {
  const departOn = fieldOf(after, 'depart_on')
  const status = statusLabel(after === null ? undefined : after.status)
  const price = fieldOf(after, 'price_text_override')
  const inner = price === '' ? status : `${status}，${price}`
  return `新增班期 ${departOn}（${inner}）`
}

/** Summarise a departure update by diffing the visible columns. */
function summariseDepartureUpdate(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): string {
  const departOn = fieldOf(after, 'depart_on') || fieldOf(before, 'depart_on')
  const parts: string[] = []
  const oldStatus = before === null ? undefined : before.status
  const newStatus = after === null ? undefined : after.status
  if (changed(oldStatus, newStatus)) {
    parts.push(`状态：${statusLabel(oldStatus)} → ${statusLabel(newStatus)}`)
  }
  const oldPrice = fieldOf(before, 'price_text_override')
  const newPrice = fieldOf(after, 'price_text_override')
  if (changed(before === null ? undefined : before.price_text_override, after === null ? undefined : after.price_text_override)) {
    parts.push(`单独价：${oldPrice === '' ? EMPTY_LABEL : oldPrice} → ${newPrice === '' ? EMPTY_LABEL : newPrice}`)
  }
  const oldReturn = fieldOf(before, 'return_on')
  const newReturn = fieldOf(after, 'return_on')
  if (changed(before === null ? undefined : before.return_on, after === null ? undefined : after.return_on)) {
    parts.push(`返程日期：${oldReturn === '' ? EMPTY_LABEL : oldReturn} → ${newReturn === '' ? EMPTY_LABEL : newReturn}`)
  }
  if (parts.length === 0) {
    return `班期 ${departOn}：已保存（内容没有变化）`
  }
  return `班期 ${departOn}：${parts.join('；')}`
}

/** Cut a summary to the maximum display length. */
function cutSummary(summary: string): string {
  if (summary.length <= MAX_SUMMARY_LENGTH) {
    return summary
  }
  return `${summary.slice(0, MAX_SUMMARY_LENGTH - 1)}…`
}

/** Plain-Chinese one-liner for a single change-log entry. */
export function summariseEntry(entry: ChangeLogEntry): string {
  let summary: string
  if (entry.entity === 'tour') {
    if (entry.action === 'insert') {
      summary = '新增团'
    } else if (entry.action === 'delete') {
      summary = '删除团'
    } else {
      summary = summariseTourUpdate(entry.before, entry.after)
    }
  } else if (entry.action === 'insert') {
    summary = summariseDepartureInsert(entry.after)
  } else if (entry.action === 'delete') {
    summary = `删除班期 ${fieldOf(entry.before, 'depart_on')}`
  } else {
    summary = summariseDepartureUpdate(entry.before, entry.after)
  }
  return cutSummary(summary)
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

export interface ChangeViewContext {
  /** tour id → current tour name */
  tourNames: ReadonlyMap<string, string>
  label: ActorLabeler
}

/** The tour id an entry belongs to, or null when it cannot be resolved. */
function tourIdOf(entry: ChangeLogEntry): string | null {
  if (entry.entity === 'tour') {
    return entry.entityId
  }
  const fromAfter = fieldOf(entry.after, 'tour_id')
  if (fromAfter !== '') {
    return fromAfter
  }
  const fromBefore = fieldOf(entry.before, 'tour_id')
  return fromBefore === '' ? null : fromBefore
}

/** The display name of the tour an entry belongs to. */
function tourNameOf(entry: ChangeLogEntry, ctx: ChangeViewContext): string {
  const tourId = tourIdOf(entry)
  if (tourId !== null) {
    const known = ctx.tourNames.get(tourId)
    if (known !== undefined) {
      return known
    }
  }
  if (entry.entity === 'tour') {
    const fromAfter = fieldOf(entry.after, 'name')
    if (fromAfter !== '') {
      return fromAfter
    }
    return fieldOf(entry.before, 'name')
  }
  return ''
}

/** Build the summary for a collapsed import or rollback group. */
function summariseGroup(source: 'import' | 'rollback', group: readonly ChangeLogEntry[]): string {
  if (source === 'rollback') {
    return `撤销导入：恢复 ${group.length} 行`
  }
  let inserted = 0
  let updated = 0
  let deleted = 0
  for (const entry of group) {
    if (entry.action === 'insert') {
      inserted += 1
    } else if (entry.action === 'update') {
      updated += 1
    } else {
      deleted += 1
    }
  }
  let summary = `出团表导入：新增 ${inserted} 个班期、更新 ${updated} 个`
  if (deleted > 0) {
    summary += `、删除 ${deleted} 个`
  }
  return summary
}

/** The single tour shared by every entry of a group, or null when they differ. */
function sharedTourId(group: readonly ChangeLogEntry[]): string | null {
  let shared: string | null = null
  for (const entry of group) {
    const tourId = tourIdOf(entry)
    if (tourId === null) {
      return null
    }
    if (shared === null) {
      shared = tourId
    } else if (shared !== tourId) {
      return null
    }
  }
  return shared
}

/** Build one collapsed view from a group of import/rollback entries. */
function buildGroupView(
  source: 'import' | 'rollback',
  group: readonly ChangeLogEntry[],
  ctx: ChangeViewContext,
): CatalogChangeView {
  const first = group[0]
  const tourId = sharedTourId(group)
  const tourName = tourId === null ? '' : ctx.tourNames.get(tourId) ?? ''
  return {
    id: first.id,
    createdAt: first.createdAt,
    actorLabel: ctx.label(parseActor(first.actor).email),
    source,
    tourId,
    tourName,
    summary: summariseGroup(source, group),
  }
}

/** Build one view from a single non-collapsed entry. */
function buildSingleView(entry: ChangeLogEntry, ctx: ChangeViewContext): CatalogChangeView {
  const parsed = parseActor(entry.actor)
  return {
    id: entry.id,
    createdAt: entry.createdAt,
    actorLabel: ctx.label(parsed.email),
    source: parsed.source,
    tourId: tourIdOf(entry),
    tourName: tourNameOf(entry, ctx),
    summary: summariseEntry(entry),
  }
}

// ---------------------------------------------------------------------------
// System runs (e.g. reading the website in: dozens of rows within a few seconds)
// ---------------------------------------------------------------------------

/** Neighbouring system rows at most this far apart belong to the same run. */
export const SYSTEM_RUN_GAP_MS = 120_000

function isSystemEntry(entry: ChangeLogEntry): boolean {
  return parseActor(entry.actor).source === 'system'
}

/** True when two neighbouring rows are close enough in time to be one run. Unreadable times never join. */
function withinRunGap(a: ChangeLogEntry, b: ChangeLogEntry): boolean {
  const first = Date.parse(a.createdAt)
  const second = Date.parse(b.createdAt)
  if (Number.isNaN(first) || Number.isNaN(second)) {
    return false
  }
  return Math.abs(first - second) <= SYSTEM_RUN_GAP_MS
}

/** Length of the run of system rows starting at `start` (1 when the row stands alone). */
function systemRunLength(entries: readonly ChangeLogEntry[], start: number): number {
  let end = start + 1
  while (end < entries.length && isSystemEntry(entries[end]) && withinRunGap(entries[end - 1], entries[end])) {
    end += 1
  }
  return end - start
}

const SYSTEM_RUN_PARTS: ReadonlyArray<{
  action: ChangeLogEntry['action']
  entity: ChangeLogEntry['entity']
  verb: string
  noun: string
}> = [
  { action: 'insert', entity: 'tour', verb: '新增', noun: '团' },
  { action: 'insert', entity: 'departure', verb: '新增', noun: '班期' },
  { action: 'update', entity: 'tour', verb: '更新', noun: '团' },
  { action: 'update', entity: 'departure', verb: '更新', noun: '班期' },
  { action: 'delete', entity: 'tour', verb: '删除', noun: '团' },
  { action: 'delete', entity: 'departure', verb: '删除', noun: '班期' },
]

/** 「系统：新增 33 个团、21 个班期」 — counts per action and entity, zero items left out. */
function summariseSystemRun(group: readonly ChangeLogEntry[]): string {
  const parts: string[] = []
  let lastVerb = ''
  for (const part of SYSTEM_RUN_PARTS) {
    const count = group.filter((e) => e.action === part.action && e.entity === part.entity).length
    if (count === 0) {
      continue
    }
    parts.push(`${part.verb === lastVerb ? '' : `${part.verb} `}${count} 个${part.noun}`)
    lastVerb = part.verb
  }
  return cutSummary(`${SYSTEM_LABEL}：${parts.join('、')}`)
}

/** One view for a whole system run; the time shown is the newest row's. */
function buildSystemRunView(group: readonly ChangeLogEntry[], ctx: ChangeViewContext): CatalogChangeView {
  let newest = group[0]
  for (const entry of group) {
    if (Date.parse(entry.createdAt) > Date.parse(newest.createdAt)) {
      newest = entry
    }
  }
  return {
    id: newest.id,
    createdAt: newest.createdAt,
    actorLabel: ctx.label(null),
    source: 'system',
    tourId: null,
    tourName: '',
    summary: summariseSystemRun(group),
  }
}

/** Group key for a collapsible entry, or null when it stands alone. */
function groupKeyOf(entry: ChangeLogEntry): string | null {
  const parsed = parseActor(entry.actor)
  if (parsed.source !== 'import' && parsed.source !== 'rollback') {
    return null
  }
  return `${parsed.source}:${parsed.batchId}`
}

/** Turn raw change-log rows into display-ready views, collapsing imports, rollbacks and system runs. */
export function buildChangeViews(
  entries: readonly ChangeLogEntry[],
  ctx: ChangeViewContext,
): CatalogChangeView[] {
  const groups = new Map<string, ChangeLogEntry[]>()
  for (const entry of entries) {
    const key = groupKeyOf(entry)
    if (key === null) {
      continue
    }
    const existing = groups.get(key)
    if (existing === undefined) {
      groups.set(key, [entry])
    } else {
      existing.push(entry)
    }
  }

  const views: CatalogChangeView[] = []
  const emitted = new Set<string>()
  let index = 0
  while (index < entries.length && views.length < MAX_CHANGE_VIEWS) {
    const entry = entries[index]
    if (isSystemEntry(entry)) {
      const runLength = systemRunLength(entries, index)
      if (runLength > 1) {
        views.push(buildSystemRunView(entries.slice(index, index + runLength), ctx))
        index += runLength
        continue
      }
    }
    index += 1
    const key = groupKeyOf(entry)
    if (key === null) {
      views.push(buildSingleView(entry, ctx))
      continue
    }
    if (emitted.has(key)) {
      continue
    }
    emitted.add(key)
    const group = groups.get(key)
    if (group === undefined) {
      continue
    }
    const parsed = parseActor(entry.actor)
    const source = parsed.source === 'rollback' ? 'rollback' : 'import'
    views.push(buildGroupView(source, group, ctx))
  }
  return views
}
