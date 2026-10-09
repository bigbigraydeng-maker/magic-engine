/**
 * Tour catalog data access. The ONLY module that talks to the tour catalog
 * tables. Every function takes a SupabaseClient as its first argument.
 * Design: docs/specs/2026-10-09-cts-tour-catalog-in-me-design-v0.3.md
 */

import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { FirstPartyTour } from '@/lib/web-intelligence/first-party-tours'
import { norm } from './normalize'
import { toFirstPartyTours } from './output'
import type { ImportPlan } from './plan'
import type {
  CatalogAlias,
  CatalogDeparture,
  CatalogDepartureInternal,
  CatalogItineraryDay,
  CatalogTour,
  DepartureStatus,
} from './types'

// ---------------------------------------------------------------------------
// Small type guards / coercion helpers
// ---------------------------------------------------------------------------

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function asNullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function asBoolean(value: unknown): boolean {
  return typeof value === 'boolean' ? value : false
}

function asNumber(value: unknown): number {
  return typeof value === 'number' ? value : 0
}

function asNullableNumber(value: unknown): number | null {
  return typeof value === 'number' ? value : null
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.filter((item): item is string => typeof item === 'string')
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return {}
}

function asItinerary(value: unknown): CatalogItineraryDay[] {
  if (!Array.isArray(value)) {
    return []
  }
  const days: CatalogItineraryDay[] = []
  for (const item of value) {
    const rec = asRecord(item)
    const day: CatalogItineraryDay = {
      day: asNumber(rec.day),
      title: asString(rec.title),
      description: asString(rec.description),
    }
    if (Array.isArray(rec.meals)) {
      day.meals = asStringArray(rec.meals)
    }
    days.push(day)
  }
  return days
}

function asInternal(value: unknown): CatalogDepartureInternal {
  const rec = asRecord(value)
  const internal: CatalogDepartureInternal = {}
  if (typeof rec.airline === 'string') {
    internal.airline = rec.airline
  }
  if (typeof rec.capacity === 'number') {
    internal.capacity = rec.capacity
  }
  if (typeof rec.outboundRoute === 'string') {
    internal.outboundRoute = rec.outboundRoute
  }
  if (typeof rec.inboundRoute === 'string') {
    internal.inboundRoute = rec.inboundRoute
  }
  return internal
}

function asStatus(value: unknown): DepartureStatus {
  const allowed: readonly DepartureStatus[] = [
    'open',
    'limited',
    'sold_out',
    'closed',
    'cancelled',
  ]
  if (typeof value === 'string' && (allowed as readonly string[]).includes(value)) {
    return value as DepartureStatus
  }
  return 'open'
}

// ---------------------------------------------------------------------------
// Row mappers (snake_case DB row -> camelCase type)
// ---------------------------------------------------------------------------

export function mapTourRow(row: Record<string, unknown>): CatalogTour {
  return {
    id: asString(row.id),
    clientId: asString(row.client_id),
    slug: asString(row.slug),
    destination: asString(row.destination),
    tier: asString(row.tier),
    name: asString(row.name),
    title: asNullableString(row.title),
    shortDescription: asNullableString(row.short_description),
    durationText: asNullableString(row.duration_text),
    displayPriceText: asNullableString(row.display_price_text),
    highlights: asStringArray(row.highlights),
    itinerary: asItinerary(row.itinerary),
    inclusions: asStringArray(row.inclusions),
    exclusions: asStringArray(row.exclusions),
    tourCities: asStringArray(row.tour_cities),
    singleSupplement: asNullableString(row.single_supplement),
    maxGroupSize: asNullableNumber(row.max_group_size),
    isActive: asBoolean(row.is_active),
    managesDepartures: asBoolean(row.manages_departures),
    sortOrder: asNumber(row.sort_order),
    updatedAt: asString(row.updated_at),
  }
}

export function mapDepartureRow(row: Record<string, unknown>): CatalogDeparture {
  return {
    id: asString(row.id),
    tourId: asString(row.tour_id),
    clientId: asString(row.client_id),
    departOn: asString(row.depart_on),
    returnOn: asNullableString(row.return_on),
    priceTextOverride: asNullableString(row.price_text_override),
    status: asStatus(row.status),
    internal: asInternal(row.internal),
    // Preserved byte-for-byte: used as an optimistic-concurrency token.
    updatedAt: asString(row.updated_at),
  }
}

export function mapAliasRow(row: Record<string, unknown>): CatalogAlias {
  return {
    aliasNorm: asString(row.alias_norm),
    tourId: asString(row.tour_id),
  }
}

// ---------------------------------------------------------------------------
// loadCatalog
// ---------------------------------------------------------------------------

export interface CatalogSnapshot {
  tours: CatalogTour[]
  departures: CatalogDeparture[]
  aliases: CatalogAlias[]
}

function rowsOf(data: unknown): Record<string, unknown>[] {
  if (!Array.isArray(data)) {
    return []
  }
  return data.map((item) => asRecord(item))
}

export async function loadCatalog(
  db: SupabaseClient,
  clientId: string,
): Promise<CatalogSnapshot> {
  const toursRes = await db
    .from('tour_catalog_tours')
    .select('*')
    .eq('client_id', clientId)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })
  if (toursRes.error) {
    throw new Error(toursRes.error.message)
  }

  const departuresRes = await db
    .from('tour_catalog_departures')
    .select('*')
    .eq('client_id', clientId)
    .order('depart_on', { ascending: true })
  if (departuresRes.error) {
    throw new Error(departuresRes.error.message)
  }

  const aliasesRes = await db
    .from('tour_catalog_aliases')
    .select('*')
    .eq('client_id', clientId)
  if (aliasesRes.error) {
    throw new Error(aliasesRes.error.message)
  }

  return {
    tours: rowsOf(toursRes.data).map(mapTourRow),
    departures: rowsOf(departuresRes.data).map(mapDepartureRow),
    aliases: rowsOf(aliasesRes.data).map(mapAliasRow),
  }
}

/** Load the catalog and project it into the outward-facing first-party feed. */
export async function loadCatalogProducts(
  db: SupabaseClient,
  clientId: string,
  today: string,
): Promise<FirstPartyTour[]> {
  const snapshot = await loadCatalog(db, clientId)
  return toFirstPartyTours(snapshot.tours, snapshot.departures, today)
}

/** Read the client's catalog version, defaulting to 0 when no state row exists. */
export async function getCatalogVersion(
  db: SupabaseClient,
  clientId: string,
): Promise<number> {
  const res = await db
    .from('tour_catalog_state')
    .select('catalog_version')
    .eq('client_id', clientId)
    .maybeSingle()
  if (res.error) {
    throw new Error(res.error.message)
  }
  if (res.data === null || res.data === undefined) {
    return 0
  }
  return asNumber(asRecord(res.data).catalog_version)
}

// ---------------------------------------------------------------------------
// planToApplyPayload
// ---------------------------------------------------------------------------

export interface ApplyPayload {
  adds: Array<{
    tourId: string
    departOn: string
    returnOn: string
    status: DepartureStatus
    internal: CatalogDepartureInternal
  }>
  updates: Array<{
    departureId: string
    expectedUpdatedAt: string
    returnOn: string
    status: DepartureStatus
    internal: CatalogDepartureInternal
  }>
}

export function planToApplyPayload(plan: ImportPlan): ApplyPayload {
  return {
    adds: plan.adds.map((add) => ({
      tourId: add.tourId,
      departOn: add.departOn,
      returnOn: add.returnOn,
      status: add.status,
      internal: add.internal,
    })),
    updates: plan.updates.map((update) => ({
      departureId: update.departureId,
      expectedUpdatedAt: update.before.updatedAt,
      returnOn: update.after.returnOn,
      status: update.after.status,
      internal: update.after.internal,
    })),
  }
}

// ---------------------------------------------------------------------------
// planHash
// ---------------------------------------------------------------------------

/** Stable stringify with recursively sorted object keys. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return '[' + value.map(stableStringify).join(',') + ']'
  }
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(obj[k])).join(',') + '}'
}

/** Deterministic sha256 hex of the apply payload plus its warning count. */
export function planHash(payload: ApplyPayload, warningCount: number): string {
  const canonical = stableStringify({
    adds: payload.adds,
    updates: payload.updates,
    warningCount,
  })
  return createHash('sha256').update(canonical).digest('hex')
}

// ---------------------------------------------------------------------------
// Batches
// ---------------------------------------------------------------------------

export interface StoredBatch {
  id: string
  clientId: string
  kind: string
  status: string
  fileSha256: string
  rowCounts: Record<string, unknown>
  plan: Record<string, unknown>
  createdAt: string
}

function mapBatchRow(row: Record<string, unknown>): StoredBatch {
  return {
    id: asString(row.id),
    clientId: asString(row.client_id),
    kind: asString(row.kind),
    status: asString(row.status),
    fileSha256: asString(row.file_sha256),
    rowCounts: asRecord(row.row_counts),
    plan: asRecord(row.plan),
    createdAt: asString(row.created_at),
  }
}

export async function getBatch(
  db: SupabaseClient,
  clientId: string,
  batchId: string,
): Promise<StoredBatch | null> {
  const res = await db
    .from('tour_catalog_import_batches')
    .select('*')
    .eq('id', batchId)
    .eq('client_id', clientId)
    .maybeSingle()
  if (res.error) {
    throw new Error(res.error.message)
  }
  if (res.data === null || res.data === undefined) {
    return null
  }
  return mapBatchRow(asRecord(res.data))
}

export async function listRecentBatches(
  db: SupabaseClient,
  clientId: string,
  limit = 20,
): Promise<StoredBatch[]> {
  const res = await db
    .from('tour_catalog_import_batches')
    .select('*')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (res.error) {
    throw new Error(res.error.message)
  }
  return rowsOf(res.data).map(mapBatchRow)
}

export type CreateBatchResult =
  | { ok: true; batchId: string }
  | { ok: false; reason: 'duplicate_file'; existingBatchId: string }
  | { ok: false; reason: 'db_error'; message: string }

interface CreateBatchArgs {
  clientId: string
  kind: 'departures' | 'status'
  fileSha256: string
  payload: ApplyPayload
  summary: Record<string, unknown>
}

function isUniqueViolation(error: { code?: string } | null): boolean {
  return error !== null && error.code === '23505'
}

/**
 * Look up a live batch (previewed or applied) for the same file. Rolled-back
 * batches are history only and never block a new preview.
 */
async function findExistingBatch(
  db: SupabaseClient,
  args: CreateBatchArgs,
): Promise<{ id: string; status: string } | null> {
  const res = await db
    .from('tour_catalog_import_batches')
    .select('id,status')
    .eq('client_id', args.clientId)
    .eq('kind', args.kind)
    .eq('file_sha256', args.fileSha256)
    .in('status', ['previewed', 'applied'])
    .maybeSingle()
  if (res.error || res.data === null || res.data === undefined) {
    return null
  }
  const row = asRecord(res.data)
  return { id: asString(row.id), status: asString(row.status) }
}

/**
 * Re-previewing the same file refreshes the still-unapplied batch instead of
 * being refused as a duplicate. Only row_counts and plan are updated.
 */
async function refreshPreviewBatch(
  db: SupabaseClient,
  args: CreateBatchArgs,
  batchId: string,
  plan: Record<string, unknown>,
): Promise<CreateBatchResult> {
  const res = await db
    .from('tour_catalog_import_batches')
    .update({
      row_counts: args.summary,
      plan,
    })
    .eq('id', batchId)
    .eq('client_id', args.clientId)
    .eq('status', 'previewed')
    .select('id')
    .maybeSingle()
  if (res.error || res.data === null || res.data === undefined) {
    return { ok: false, reason: 'db_error', message: res.error?.message ?? 'refresh_returned_no_row' }
  }
  return { ok: true, batchId }
}

export async function createPreviewBatch(
  db: SupabaseClient,
  args: CreateBatchArgs,
): Promise<CreateBatchResult> {
  const plan = { ...args.payload, summary: args.summary }
  const res = await db
    .from('tour_catalog_import_batches')
    .insert({
      client_id: args.clientId,
      kind: args.kind,
      file_sha256: args.fileSha256,
      row_counts: args.summary,
      plan,
      status: 'previewed',
    })
    .select('id')
    .maybeSingle()

  if (res.error) {
    if (isUniqueViolation(res.error)) {
      const existing = await findExistingBatch(db, args)
      if (existing !== null) {
        if (existing.status === 'previewed') {
          return refreshPreviewBatch(db, args, existing.id, plan)
        }
        return { ok: false, reason: 'duplicate_file', existingBatchId: existing.id }
      }
    }
    return { ok: false, reason: 'db_error', message: res.error.message }
  }

  if (res.data === null || res.data === undefined) {
    return { ok: false, reason: 'db_error', message: 'insert_returned_no_row' }
  }
  return { ok: true, batchId: asString(asRecord(res.data).id) }
}

// ---------------------------------------------------------------------------
// applyBatch / rollbackBatch
// ---------------------------------------------------------------------------

export type BatchActionResult =
  | { ok: true; result: Record<string, unknown> }
  | { ok: false; code: 'not_applicable' | 'conflict' | 'error'; message: string }

function mapBatchError(message: string): BatchActionResult {
  if (message === 'batch_not_applicable' || message === 'batch_not_rollbackable') {
    return { ok: false, code: 'not_applicable', message }
  }
  if (message.startsWith('conflict:')) {
    return { ok: false, code: 'conflict', message }
  }
  return { ok: false, code: 'error', message }
}

export async function applyBatch(
  db: SupabaseClient,
  clientId: string,
  batchId: string,
  appliedBy: string,
): Promise<BatchActionResult> {
  const res = await db.rpc('tour_catalog_apply_batch', {
    p_client_id: clientId,
    p_batch_id: batchId,
    p_applied_by: appliedBy,
  })
  if (res.error) {
    return mapBatchError(res.error.message)
  }
  return { ok: true, result: asRecord(res.data) }
}

export async function rollbackBatch(
  db: SupabaseClient,
  clientId: string,
  batchId: string,
): Promise<BatchActionResult> {
  const res = await db.rpc('tour_catalog_rollback_batch', {
    p_client_id: clientId,
    p_batch_id: batchId,
  })
  if (res.error) {
    return mapBatchError(res.error.message)
  }
  return { ok: true, result: asRecord(res.data) }
}

// ---------------------------------------------------------------------------
// addAlias / removeAlias
// ---------------------------------------------------------------------------

export type AddAliasResult =
  | { ok: true; aliasNorm: string }
  | { ok: false; message: string; existingTourId?: string }

export async function addAlias(
  db: SupabaseClient,
  clientId: string,
  rawAlias: string,
  tourId: string,
): Promise<AddAliasResult> {
  const aliasNorm = norm(rawAlias)
  if (aliasNorm === '') {
    return { ok: false, message: 'empty_alias' }
  }

  const tourRes = await db
    .from('tour_catalog_tours')
    .select('id')
    .eq('id', tourId)
    .eq('client_id', clientId)
    .maybeSingle()
  if (tourRes.error) {
    console.error('addAlias: tour lookup failed', tourRes.error)
    return { ok: false, message: 'alias_failed' }
  }
  if (tourRes.data === null || tourRes.data === undefined) {
    return { ok: false, message: 'tour_not_found' }
  }

  const existingRes = await db
    .from('tour_catalog_aliases')
    .select('tour_id')
    .eq('client_id', clientId)
    .eq('alias_norm', aliasNorm)
    .maybeSingle()
  if (existingRes.error) {
    console.error('addAlias: alias lookup failed', existingRes.error)
    return { ok: false, message: 'alias_failed' }
  }
  if (existingRes.data !== null && existingRes.data !== undefined) {
    const existingTourId = asString(asRecord(existingRes.data).tour_id)
    if (existingTourId !== tourId) {
      return { ok: false, message: 'alias_taken', existingTourId }
    }
    return { ok: true, aliasNorm }
  }

  const insertRes = await db
    .from('tour_catalog_aliases')
    .insert({ client_id: clientId, alias_norm: aliasNorm, tour_id: tourId })
  if (insertRes.error) {
    console.error('addAlias: insert failed', insertRes.error)
    return { ok: false, message: 'alias_failed' }
  }
  return { ok: true, aliasNorm }
}

export type RemoveAliasResult =
  | { ok: true }
  | { ok: false; message: 'alias_not_found' | 'alias_failed' }

export async function removeAlias(
  db: SupabaseClient,
  clientId: string,
  aliasNorm: string,
): Promise<RemoveAliasResult> {
  const res = await db
    .from('tour_catalog_aliases')
    .delete()
    .eq('client_id', clientId)
    .eq('alias_norm', aliasNorm)
    .select('alias_norm')
    .maybeSingle()
  if (res.error) {
    console.error('removeAlias: delete failed', res.error)
    return { ok: false, message: 'alias_failed' }
  }
  if (res.data === null || res.data === undefined) {
    return { ok: false, message: 'alias_not_found' }
  }
  return { ok: true }
}

/** The client's own website domain as configured on the client record (null when unset). */
export async function getClientDomain(db: SupabaseClient, clientId: string): Promise<string | null> {
  const res = await db.from('clients').select('domain').eq('id', clientId).maybeSingle()
  if (res.error) throw new Error(res.error.message)
  const domain = res.data === null || res.data === undefined ? null : asRecord(res.data).domain
  return typeof domain === 'string' && domain.trim() !== '' ? domain : null
}

// ---------------------------------------------------------------------------
// Admin editing (RPCs from 20261010100000_tour_catalog_edit.sql)
// ---------------------------------------------------------------------------

export type EditResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: 'conflict' | 'not_found' | 'invalid' | 'duplicate' | 'error'; message: string }

/** Map a raw RPC error message to a coarse code. `message` is always the raw text. */
export function mapEditError(message: string): EditResult<never> {
  if (message.startsWith('conflict:stale')) {
    return { ok: false, code: 'conflict', message }
  }
  if (message.startsWith('conflict:duplicate_departure')) {
    return { ok: false, code: 'duplicate', message }
  }
  if (message === 'tour_not_found' || message === 'departure_not_found') {
    return { ok: false, code: 'not_found', message }
  }
  if (
    message.startsWith('field_not_editable') ||
    message.startsWith('invalid_null') ||
    message === 'depart_on_not_editable' ||
    message === 'depart_on_required' ||
    message === 'invalid_dates'
  ) {
    return { ok: false, code: 'invalid', message }
  }
  return { ok: false, code: 'error', message }
}

export async function updateTour(
  db: SupabaseClient,
  clientId: string,
  tourId: string,
  expectedUpdatedAt: string,
  dbPatch: Record<string, unknown>,
  actor: string,
): Promise<EditResult<CatalogTour>> {
  const res = await db.rpc('tour_catalog_update_tour', {
    p_client_id: clientId,
    p_tour_id: tourId,
    p_expected_updated_at: expectedUpdatedAt,
    p_patch: dbPatch,
    p_actor: actor,
  })
  if (res.error) {
    return mapEditError(res.error.message)
  }
  return { ok: true, value: mapTourRow(asRecord(res.data)) }
}

export async function saveDeparture(
  db: SupabaseClient,
  clientId: string,
  tourId: string,
  departureId: string | null,
  expectedUpdatedAt: string | null,
  dbFields: Record<string, unknown>,
  actor: string,
): Promise<EditResult<CatalogDeparture>> {
  const res = await db.rpc('tour_catalog_save_departure', {
    p_client_id: clientId,
    p_tour_id: tourId,
    p_departure_id: departureId,
    p_expected_updated_at: expectedUpdatedAt,
    p_fields: dbFields,
    p_actor: actor,
  })
  if (res.error) {
    return mapEditError(res.error.message)
  }
  return { ok: true, value: mapDepartureRow(asRecord(res.data)) }
}

export interface ChangeLogEntry {
  id: string
  entity: 'tour' | 'departure'
  entityId: string
  action: 'insert' | 'update' | 'delete'
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
  actor: string
  createdAt: string
}

function asEntity(value: unknown): 'tour' | 'departure' {
  return value === 'departure' ? 'departure' : 'tour'
}

function asAction(value: unknown): 'insert' | 'update' | 'delete' {
  if (value === 'insert' || value === 'delete') {
    return value
  }
  return 'update'
}

function asNullableRecord(value: unknown): Record<string, unknown> | null {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return null
}

function mapChangeLogRow(row: Record<string, unknown>): ChangeLogEntry {
  return {
    id: asString(row.id),
    entity: asEntity(row.entity),
    entityId: asString(row.entity_id),
    action: asAction(row.action),
    before: asNullableRecord(row.before),
    after: asNullableRecord(row.after),
    actor: asString(row.actor),
    createdAt: asString(row.created_at),
  }
}

export async function listChanges(
  db: SupabaseClient,
  clientId: string,
  entityIds: string[],
  limit = 50,
): Promise<ChangeLogEntry[]> {
  if (entityIds.length === 0) {
    return []
  }
  const res = await db
    .from('tour_catalog_change_log')
    .select('*')
    .eq('client_id', clientId)
    .in('entity_id', entityIds)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (res.error) {
    throw new Error(res.error.message)
  }
  return rowsOf(res.data).map(mapChangeLogRow)
}

export interface DepartureLabel {
  tourName: string
  departOn: string
}

export async function getDepartureLabel(
  db: SupabaseClient,
  clientId: string,
  departureId: string,
): Promise<DepartureLabel | null> {
  const depRes = await db
    .from('tour_catalog_departures')
    .select('depart_on, tour_id')
    .eq('id', departureId)
    .eq('client_id', clientId)
    .maybeSingle()
  if (depRes.error || depRes.data === null || depRes.data === undefined) {
    return null
  }
  const dep = asRecord(depRes.data)
  const tourId = asString(dep.tour_id)
  if (tourId === '') {
    return null
  }

  const tourRes = await db
    .from('tour_catalog_tours')
    .select('name')
    .eq('id', tourId)
    .eq('client_id', clientId)
    .maybeSingle()
  if (tourRes.error || tourRes.data === null || tourRes.data === undefined) {
    return null
  }

  return {
    tourName: asString(asRecord(tourRes.data).name),
    departOn: asString(dep.depart_on),
  }
}
