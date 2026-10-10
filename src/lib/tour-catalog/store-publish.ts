/**
 * Tour catalog — publish / revert / published reads. Split from store.ts (800-line limit).
 * Outward channels read ONLY through loadPublishedProducts.
 * Design: docs/specs/2026-10-09-cts-tour-catalog-in-me-design-v0.3.md §6.8.1
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { FirstPartyTour } from '@/lib/web-intelligence/first-party-tours'
import { asRecord, asString, loadDraftCatalog, rowsOf } from './store'
import type { CatalogDeparture, CatalogTour } from './types'
import { parseDepartureDisplay } from './dates'
import { markPublishRequestsHandled } from './store-access'
import { toFirstPartyTours } from './output'
import {
  computeDiffHash,
  diffCatalog,
  keepCurrentStatuses,
  parsePublishedSnapshot,
  projectCatalog,
  type CatalogContent,
} from './publish'
import type {
  FirstPublishRow,
  PublishErrorCode,
  PublishPreviewResponse,
  PublishRequest,
  PublishedVersionView,
  RevertPreviewResponse,
  RevertRequest,
} from './publish-contract'

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function num(value: unknown): number {
  return typeof value === 'number' ? value : 0
}

function numOrNull(value: unknown): number | null {
  return typeof value === 'number' ? value : null
}

// ---------------------------------------------------------------------------
// getPublishState
// ---------------------------------------------------------------------------

export interface PublishState {
  draftVersion: number
  publishedVersion: number
}

/** Read the client's draft/published revision counters; a missing row means both are 0. */
export async function getPublishState(db: SupabaseClient, clientId: string): Promise<PublishState> {
  const res = await db
    .from('tour_catalog_state')
    .select('catalog_version, published_version')
    .eq('client_id', clientId)
    .maybeSingle()
  if (res.error) {
    throw new Error(res.error.message)
  }
  if (res.data === null || res.data === undefined) {
    return { draftVersion: 0, publishedVersion: 0 }
  }
  const row = asRecord(res.data)
  return {
    draftVersion: num(row.catalog_version),
    publishedVersion: num(row.published_version),
  }
}

// ---------------------------------------------------------------------------
// Published reads
// ---------------------------------------------------------------------------

export type PublishedRead =
  | { published: false }
  | {
      published: true
      version: number
      createdAt: string
      publishedBy: string
      sourceVersion: number | null
      tours: CatalogTour[]
      departures: CatalogDeparture[]
    }

const PUBLISHED_COLUMNS = 'version, snapshot, created_at, published_by, source_version'

function mapPublishedRow(row: Record<string, unknown>, clientId: string): PublishedRead {
  const version = num(row.version)
  const content = parsePublishedSnapshot(row.snapshot)
  if (content === null) {
    console.error('tour_catalog_published_unreadable', { clientId, version })
    return { published: false }
  }
  return {
    published: true,
    version,
    createdAt: asString(row.created_at),
    publishedBy: asString(row.published_by),
    sourceVersion: numOrNull(row.source_version),
    tours: content.tours,
    departures: content.departures,
  }
}

/** Read the highest published version and its content. Fails closed on unreadable snapshots. */
export async function loadPublished(db: SupabaseClient, clientId: string): Promise<PublishedRead> {
  const res = await db
    .from('tour_catalog_published')
    .select(PUBLISHED_COLUMNS)
    .eq('client_id', clientId)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (res.error) {
    throw new Error(res.error.message)
  }
  if (res.data === null || res.data === undefined) {
    return { published: false }
  }
  return mapPublishedRow(asRecord(res.data), clientId)
}

/** Read one specific published version and its content. */
export async function loadPublishedVersion(
  db: SupabaseClient,
  clientId: string,
  version: number,
): Promise<PublishedRead> {
  const res = await db
    .from('tour_catalog_published')
    .select(PUBLISHED_COLUMNS)
    .eq('client_id', clientId)
    .eq('version', version)
    .maybeSingle()
  if (res.error) {
    throw new Error(res.error.message)
  }
  if (res.data === null || res.data === undefined) {
    return { published: false }
  }
  return mapPublishedRow(asRecord(res.data), clientId)
}

export type PublishedProductsRead =
  | { published: false }
  | { published: true; version: number; tours: FirstPartyTour[] }

/** The ONLY reader outward channels may use: the published feed in first-party shape. */
export async function loadPublishedProducts(
  db: SupabaseClient,
  clientId: string,
  today: string,
): Promise<PublishedProductsRead> {
  const read = await loadPublished(db, clientId)
  if (!read.published) {
    return { published: false }
  }
  return {
    published: true,
    version: read.version,
    tours: toFirstPartyTours(read.tours, read.departures, today),
  }
}

// ---------------------------------------------------------------------------
// Unreadable published version
// ---------------------------------------------------------------------------

/**
 * The state row says something is published, but the latest published version cannot be read.
 * This must never be mistaken for "never published": a first-publish flow would skip the
 * comparison table and overwrite the outward feed blind.
 */
export class PublishedUnreadableError extends Error {
  constructor(clientId: string, publishedVersion: number) {
    super(`tour_catalog_published_unreadable client=${clientId} published_version=${publishedVersion}`)
    this.name = 'PublishedUnreadableError'
  }
}

function assertPublishedReadable(clientId: string, state: PublishState, read: PublishedRead): void {
  if (state.publishedVersion > 0 && !read.published) {
    throw new PublishedUnreadableError(clientId, state.publishedVersion)
  }
}

// ---------------------------------------------------------------------------
// buildPublishPreview
// ---------------------------------------------------------------------------

function publishedContentOf(read: PublishedRead): CatalogContent | null {
  if (!read.published) {
    return null
  }
  return { tours: read.tours, departures: read.departures }
}

function buildFirstPublishRows(
  draft: CatalogContent,
  today: string,
): FirstPublishRow[] {
  const feed = toFirstPartyTours(draft.tours, draft.departures, today)
  const catalogById = new Map(draft.tours.map((tour) => [tour.id, tour]))
  return feed.map((feedTour) => {
    const catalogTour = catalogById.get(feedTour.id)
    const firstDate = feedTour.departure_dates.length > 0 ? feedTour.departure_dates[0] : null
    return {
      tourId: feedTour.id,
      tourName: catalogTour === undefined ? feedTour.name : catalogTour.name,
      displayPriceText: catalogTour === undefined ? null : catalogTour.displayPriceText,
      upcomingDepartures: feedTour.departure_dates.length,
      nextDepartOn: firstDate === null ? null : parseDepartureDisplay(firstDate),
      sellable: feedTour.is_active,
    }
  })
}

/** Compare the draft against what is published and describe every outward-facing change. */
export async function buildPublishPreview(
  db: SupabaseClient,
  clientId: string,
  today: string,
): Promise<PublishPreviewResponse> {
  const state = await getPublishState(db, clientId)
  const draft = await loadDraftCatalog(db, clientId)
  const publishedRead = await loadPublished(db, clientId)
  assertPublishedReadable(clientId, state, publishedRead)

  const draftContent: CatalogContent = { tours: draft.tours, departures: draft.departures }
  const publishedContent = publishedContentOf(publishedRead)
  const diff = diffCatalog(publishedContent, draftContent, today)

  const firstPublish = !publishedRead.published
  // A first publish has no comparison table, so the sellable count is always typed by hand.
  const sellable = firstPublish ? { ...diff.sellable, needsCountConfirm: true } : diff.sellable
  const publishedVersion = publishedRead.published ? publishedRead.version : state.publishedVersion
  const afterRevert =
    publishedRead.published && publishedRead.sourceVersion !== null
      ? { toVersion: publishedRead.sourceVersion }
      : null

  return {
    publishedVersion,
    publishedAt: publishedRead.published ? publishedRead.createdAt : null,
    publishedBy: publishedRead.published ? publishedRead.publishedBy : null,
    draftVersion: state.draftVersion,
    firstPublish,
    changes: diff.changes,
    changedTourIds: diff.changedTourIds,
    highRiskCount: diff.highRiskCount,
    sellable,
    afterRevert,
    firstPublishRows: firstPublish ? buildFirstPublishRows(draftContent, today) : [],
    diffHash: computeDiffHash({
      publishedVersion,
      draftVersion: state.draftVersion,
      publishedProjection: publishedContent === null ? null : projectCatalog(publishedContent),
      draftProjection: projectCatalog(draftContent),
      highRiskCount: diff.highRiskCount,
    }),
  }
}

// ---------------------------------------------------------------------------
// publishDraft
// ---------------------------------------------------------------------------

export type PublishActionResult = { ok: true; version: number } | { ok: false; error: PublishErrorCode }

function publishSummary(preview: PublishPreviewResponse): Record<string, unknown> {
  return {
    changeCount: preview.changes.length,
    highRiskCount: preview.highRiskCount,
    sellableBefore: preview.sellable.before,
    sellableAfter: preview.sellable.after,
    changes: preview.changes.slice(0, 200),
  }
}

function checkPublishRequest(
  preview: PublishPreviewResponse,
  req: PublishRequest,
): PublishErrorCode | null {
  if (
    req.draftVersion !== preview.draftVersion ||
    req.publishedVersion !== preview.publishedVersion ||
    req.diffHash !== preview.diffHash
  ) {
    return 'stale'
  }
  const nothingToPublish = preview.firstPublish
    ? preview.firstPublishRows.length === 0
    : preview.changes.length === 0
  if (nothingToPublish) {
    return 'nothing_to_publish'
  }
  if (preview.highRiskCount > 0 && req.acknowledgeHighRisk !== true) {
    return 'high_risk_unacknowledged'
  }
  if (preview.afterRevert !== null && req.acknowledgeAfterRevert !== true) {
    return 'after_revert_unacknowledged'
  }
  if (preview.sellable.needsCountConfirm && req.confirmSellableCount !== preview.sellable.after) {
    return 'sellable_count_mismatch'
  }
  return null
}

/** Publish the current draft. The preview is always recomputed server-side. */
export async function publishDraft(
  db: SupabaseClient,
  clientId: string,
  req: PublishRequest,
  actor: string,
  today: string,
): Promise<PublishActionResult> {
  let preview: PublishPreviewResponse
  try {
    preview = await buildPublishPreview(db, clientId, today)
  } catch (err) {
    if (err instanceof PublishedUnreadableError) {
      console.error('tour_catalog_publish_refused', err.message)
      return { ok: false, error: 'publish_failed' }
    }
    throw err
  }
  const failure = checkPublishRequest(preview, req)
  if (failure !== null) {
    return { ok: false, error: failure }
  }

  const res = await db.rpc('tour_catalog_publish', {
    p_client_id: clientId,
    p_expected_draft_version: preview.draftVersion,
    p_expected_published_version: preview.publishedVersion,
    p_actor: actor,
    p_note: req.note,
    p_summary: publishSummary(preview),
  })
  if (res.error) {
    if (res.error.message.includes('conflict:stale')) {
      return { ok: false, error: 'stale' }
    }
    console.error('tour_catalog_publish_failed', res.error.message)
    return { ok: false, error: 'publish_failed' }
  }
  const version = num(asRecord(res.data).version)
  // Publishing closes any open "please publish" request. The publish itself already happened:
  // a failure here is logged and never turns the result into an error.
  try {
    await markPublishRequestsHandled(db, clientId, version)
  } catch (err) {
    console.error('tour_catalog_publish_request_close_failed', err instanceof Error ? err.message : err)
  }
  return { ok: true, version }
}

// ---------------------------------------------------------------------------
// buildRevertPreview
// ---------------------------------------------------------------------------

function contentOf(read: PublishedRead): CatalogContent {
  if (!read.published) {
    return { tours: [], departures: [] }
  }
  return { tours: read.tours, departures: read.departures }
}

/** What going back to version N would change outward (departure statuses stay current). */
export async function buildRevertPreview(
  db: SupabaseClient,
  clientId: string,
  targetVersion: number,
  today: string,
): Promise<RevertPreviewResponse | { error: PublishErrorCode }> {
  const state = await getPublishState(db, clientId)
  const current = await loadPublished(db, clientId)
  assertPublishedReadable(clientId, state, current)
  if (!current.published) {
    return { error: 'version_not_found' }
  }
  if (targetVersion === current.version) {
    return { error: 'already_current' }
  }
  const target = await loadPublishedVersion(db, clientId, targetVersion)
  if (!target.published) {
    return { error: 'version_not_found' }
  }

  const currentContent = contentOf(current)
  const targetContent = contentOf(target)
  const merged = keepCurrentStatuses(targetContent, currentContent)
  const diff = diffCatalog(currentContent, merged.content, today)

  return {
    targetVersion,
    publishedVersion: current.version,
    changes: diff.changes,
    highRiskCount: diff.highRiskCount,
    keptStatuses: merged.kept,
    sellable: diff.sellable,
    diffHash: computeDiffHash({
      publishedVersion: current.version,
      draftVersion: 0,
      publishedProjection: projectCatalog(currentContent),
      draftProjection: projectCatalog(merged.content),
      highRiskCount: diff.highRiskCount,
      revertTargetVersion: targetVersion,
    }),
  }
}

// ---------------------------------------------------------------------------
// revertPublished
// ---------------------------------------------------------------------------

function revertSummary(preview: RevertPreviewResponse): Record<string, unknown> {
  return {
    changeCount: preview.changes.length,
    highRiskCount: preview.highRiskCount,
    sellableBefore: preview.sellable.before,
    sellableAfter: preview.sellable.after,
    changes: preview.changes.slice(0, 200),
  }
}

function checkRevertRequest(
  preview: RevertPreviewResponse,
  req: RevertRequest,
): PublishErrorCode | null {
  if (req.publishedVersion !== preview.publishedVersion || req.diffHash !== preview.diffHash) {
    return 'stale'
  }
  if (preview.changes.length === 0) {
    return 'nothing_to_publish'
  }
  if (preview.highRiskCount > 0 && req.acknowledgeHighRisk !== true) {
    return 'high_risk_unacknowledged'
  }
  if (preview.sellable.needsCountConfirm && req.confirmSellableCount !== preview.sellable.after) {
    return 'sellable_count_mismatch'
  }
  return null
}

function mapRevertError(message: string): PublishErrorCode {
  if (message.includes('conflict:stale')) {
    return 'stale'
  }
  if (message.includes('already_current')) {
    return 'already_current'
  }
  if (message.includes('version_not_found')) {
    return 'version_not_found'
  }
  console.error('tour_catalog_revert_published_failed', message)
  return 'publish_failed'
}

/** Revert the outward feed to an older published version (a new version is appended). */
export async function revertPublished(
  db: SupabaseClient,
  clientId: string,
  req: RevertRequest,
  actor: string,
  today: string,
): Promise<PublishActionResult> {
  let preview: RevertPreviewResponse | { error: PublishErrorCode }
  try {
    preview = await buildRevertPreview(db, clientId, req.version, today)
  } catch (err) {
    if (err instanceof PublishedUnreadableError) {
      console.error('tour_catalog_revert_refused', err.message)
      return { ok: false, error: 'publish_failed' }
    }
    throw err
  }
  if ('error' in preview) {
    return { ok: false, error: preview.error }
  }
  const failure = checkRevertRequest(preview, req)
  if (failure !== null) {
    return { ok: false, error: failure }
  }

  const res = await db.rpc('tour_catalog_revert_published', {
    p_client_id: clientId,
    p_target_version: req.version,
    p_expected_published_version: preview.publishedVersion,
    p_actor: actor,
    p_note: '',
    p_summary: revertSummary(preview),
  })
  if (res.error) {
    return { ok: false, error: mapRevertError(res.error.message) }
  }
  return { ok: true, version: num(asRecord(res.data).version) }
}

// ---------------------------------------------------------------------------
// listPublishedVersions
// ---------------------------------------------------------------------------

function mapVersionRow(row: Record<string, unknown>, isCurrent: boolean): PublishedVersionView {
  const summary = asRecord(row.summary)
  return {
    version: num(row.version),
    createdAt: asString(row.created_at),
    publishedBy: asString(row.published_by),
    note: asString(row.note),
    sourceVersion: numOrNull(row.source_version),
    changeCount: num(summary.changeCount),
    highRiskCount: num(summary.highRiskCount),
    isCurrent,
  }
}

/** Published version history, newest first. Never selects the snapshot column. */
export async function listPublishedVersions(
  db: SupabaseClient,
  clientId: string,
  limit = 50,
): Promise<PublishedVersionView[]> {
  const res = await db
    .from('tour_catalog_published')
    .select('version, created_at, published_by, note, source_version, summary')
    .eq('client_id', clientId)
    .order('version', { ascending: false })
    .limit(limit)
  if (res.error) {
    throw new Error(res.error.message)
  }
  const rows = rowsOf(res.data)
  const highest = rows.reduce((max, row) => Math.max(max, num(row.version)), 0)
  return rows.map((row) => mapVersionRow(row, num(row.version) === highest))
}
