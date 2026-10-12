/**
 * Tour catalog data access. The ONLY module that talks to the tour catalog
 * tables. Every function takes a SupabaseClient as its first argument.
 * Design: docs/specs/2026-10-09-cts-tour-catalog-in-me-design-v0.3.md
 */

import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAll } from '@/lib/supabase-paginate'
import { norm } from './normalize'
import { readDayExtras, readTourContent } from './content-fields'
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

export function asString(value: unknown): string {
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

export function asRecord(value: unknown): Record<string, unknown> {
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
    Object.assign(day, readDayExtras(rec))
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
    ...readTourContent(row),
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
// loadDraftCatalog
// ---------------------------------------------------------------------------

export interface CatalogSnapshot {
  tours: CatalogTour[]
  departures: CatalogDeparture[]
  aliases: CatalogAlias[]
}

export function rowsOf(data: unknown): Record<string, unknown>[] {
  if (!Array.isArray(data)) {
    return []
  }
  return data.map((item) => asRecord(item))
}

/**
 * Read the DRAFT (working tables). Admin tooling only: outward channels must read the
 * published snapshot via store-publish.ts. Guarded by __tests__/boundary.test.ts.
 */
export async function loadDraftCatalog(
  db: SupabaseClient,
  clientId: string,
): Promise<CatalogSnapshot> {
  // PostgREST caps one response at 1000 rows without an error, so every list is paged with a
  // stable order (the trailing id / primary-key column makes page boundaries deterministic).
  const tourRows = await fetchAll<Record<string, unknown>>((from, to) =>
    db
      .from('tour_catalog_tours')
      .select('*')
      .eq('client_id', clientId)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to),
  )

  const departureRows = await fetchAll<Record<string, unknown>>((from, to) =>
    db
      .from('tour_catalog_departures')
      .select('*')
      .eq('client_id', clientId)
      .order('depart_on', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to),
  )

  const aliasRows = await fetchAll<Record<string, unknown>>((from, to) =>
    db
      .from('tour_catalog_aliases')
      .select('*')
      .eq('client_id', clientId)
      .order('alias_norm', { ascending: true })
      .range(from, to),
  )

  return {
    tours: rowsOf(tourRows).map(mapTourRow),
    departures: rowsOf(departureRows).map(mapDepartureRow),
    aliases: rowsOf(aliasRows).map(mapAliasRow),
  }
}

async function readStateNumber(
  db: SupabaseClient,
  clientId: string,
  column: 'catalog_version' | 'published_version',
): Promise<number> {
  const res = await db
    .from('tour_catalog_state')
    .select(column)
    .eq('client_id', clientId)
    .maybeSingle()
  if (res.error) {
    throw new Error(res.error.message)
  }
  if (res.data === null || res.data === undefined) {
    return 0
  }
  return asNumber(asRecord(res.data)[column])
}

/** Draft revision (bumped by every working-table write); 0 when no state row exists. Concurrency token only. */
export async function getDraftRevision(db: SupabaseClient, clientId: string): Promise<number> {
  return readStateNumber(db, clientId, 'catalog_version')
}

/** Outward-facing version number (only grows; a revert is a new version); 0 = never published. */
export async function getPublishedVersion(db: SupabaseClient, clientId: string): Promise<number> {
  return readStateNumber(db, clientId, 'published_version')
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
export function stableStringify(value: unknown): string {
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
  actor?: string,
): Promise<BatchActionResult> {
  const res = await db.rpc('tour_catalog_rollback_batch', {
    p_client_id: clientId,
    p_batch_id: batchId,
    p_actor: actor ?? null,
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
