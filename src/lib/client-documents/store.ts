import { supabaseAdmin } from '@/lib/supabase'
import { LIST_LIMIT, type DocumentCategory, type DocumentVisibility } from './constants'
import type { DocumentScope } from './access'
import type { DocumentPatch } from './input'
import {
  toDocumentRow,
  toDocumentRows,
  toDownloadTarget,
  toIdTitle,
  type DownloadTarget,
  type IdTitle,
} from './row'
import type { DocumentRow } from './types'

/**
 * Database side of the document library. Every query is scoped by client_id, and the
 * client-visible scope additionally filters on visibility and status, so a client member
 * can never read an internal or archived row even when they know its id.
 */

const TABLE = 'client_documents'
const CLIENT_COLUMNS = 'id, category, title, description, version_label, visibility, status, original_filename, mime_type, size_bytes, created_at'
const INTERNAL_COLUMNS = `${CLIENT_COLUMNS}, uploaded_by, replaces_id, archived_at, archived_by`

export type StoreFailure = { ok: false; error: string; duplicate?: boolean; ambiguous?: boolean }

export type StoreResult<T> = { ok: true; data: T } | StoreFailure

export interface NewDocument {
  id: string
  client_id: string
  category: DocumentCategory
  title: string
  description: string | null
  version_label: string | null
  visibility: DocumentVisibility
  storage_path: string
  original_filename: string
  mime_type: string
  size_bytes: number
  sha256: string
  uploaded_by: string
  replaces_id: string | null
}

interface DbError { message: string; code?: string }

/**
 * A Postgres SQLSTATE is exactly five characters (23505, 42P01 ...) and means the database answered
 * for THAT statement, so nothing was committed. Classes 08 (connection), 57 (operator intervention),
 * 58 (system) and XX (internal) can also arrive around a commit, so they are treated as unclear.
 */
const DEFINITE_SQLSTATE = /^(?!08|57|58|XX)[0-9A-Z]{5}$/

function fail(label: string, error: DbError): StoreFailure {
  console.error(`[client-documents/${label}]`, error.code ?? '', error.message)
  return {
    ok: false,
    error: 'client_documents_unavailable',
    // 23505 = unique violation: the same content is already a current file for this client.
    duplicate: error.code === '23505',
    // No SQLSTATE (timeout, dropped connection, proxy error) = the database may or may not have
    // committed the statement. Callers must not assume "it did not happen".
    ambiguous: !DEFINITE_SQLSTATE.test(error.code ?? ''),
  }
}

function malformed(label: string): { ok: false; error: string } {
  console.error(`[client-documents/${label}] unexpected row shape`)
  return { ok: false, error: 'client_documents_unavailable' }
}

export async function clientExists(clientId: string): Promise<StoreResult<boolean>> {
  const { data, error } = await supabaseAdmin.from('clients').select('id').eq('id', clientId).maybeSingle()
  if (error) return fail('client-exists', error)
  return { ok: true, data: data !== null }
}

export async function listDocuments(
  clientId: string,
  scope: DocumentScope,
  includeArchived: boolean,
): Promise<StoreResult<DocumentRow[]>> {
  let query = supabaseAdmin
    .from(TABLE)
    .select(scope === 'all' ? INTERNAL_COLUMNS : CLIENT_COLUMNS)
    .eq('client_id', clientId)
  if (scope === 'client_visible') query = query.eq('visibility', 'client').eq('status', 'current')
  else if (!includeArchived) query = query.eq('status', 'current')

  const { data, error } = await query.order('created_at', { ascending: false }).limit(LIST_LIMIT)
  if (error) return fail('list', error)
  const rows = toDocumentRows(data ?? [], scope)
  return rows ? { ok: true, data: rows } : malformed('list')
}

/** The row a download is allowed to serve, or null (not found / not visible to this scope). */
export async function getDownloadTarget(
  clientId: string,
  docId: string,
  scope: DocumentScope,
): Promise<StoreResult<DownloadTarget | null>> {
  let query = supabaseAdmin
    .from(TABLE)
    .select('id, storage_path, original_filename')
    .eq('client_id', clientId)
    .eq('id', docId)
  if (scope === 'client_visible') query = query.eq('visibility', 'client').eq('status', 'current')

  const { data, error } = await query.maybeSingle()
  if (error) return fail('download-target', error)
  if (data === null) return { ok: true, data: null }
  const target = toDownloadTarget(data)
  return target ? { ok: true, data: target } : malformed('download-target')
}

export async function findCurrentByHash(clientId: string, sha256: string): Promise<StoreResult<IdTitle | null>> {
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select('id, title')
    .eq('client_id', clientId)
    .eq('sha256', sha256)
    .eq('status', 'current')
    .maybeSingle()
  if (error) return fail('find-by-hash', error)
  if (data === null) return { ok: true, data: null }
  const found = toIdTitle(data)
  return found ? { ok: true, data: found } : malformed('find-by-hash')
}

export async function getCurrentDocument(clientId: string, docId: string): Promise<StoreResult<IdTitle | null>> {
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select('id, title')
    .eq('client_id', clientId)
    .eq('id', docId)
    .eq('status', 'current')
    .maybeSingle()
  if (error) return fail('get-current', error)
  if (data === null) return { ok: true, data: null }
  const found = toIdTitle(data)
  return found ? { ok: true, data: found } : malformed('get-current')
}

export async function getDocumentById(clientId: string, docId: string): Promise<StoreResult<DocumentRow | null>> {
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select(INTERNAL_COLUMNS)
    .eq('client_id', clientId)
    .eq('id', docId)
    .maybeSingle()
  if (error) return fail('get-by-id', error)
  if (data === null) return { ok: true, data: null }
  const row = toDocumentRow(data, 'all')
  return row ? { ok: true, data: row } : malformed('get-by-id')
}

export async function insertDocument(row: NewDocument): Promise<StoreResult<DocumentRow>> {
  const { data, error } = await supabaseAdmin.from(TABLE).insert(row).select(INTERNAL_COLUMNS).single()
  if (error) return fail('insert', error)
  const inserted = toDocumentRow(data, 'all')
  return inserted ? { ok: true, data: inserted } : malformed('insert')
}

/** Pure: turns an edit request into the columns to write. Archiving stamps who and when. */
export function patchToUpdate(patch: DocumentPatch, actor: string, now: Date): Record<string, unknown> {
  const update: Record<string, unknown> = {}
  if (patch.title !== undefined) update.title = patch.title
  if (patch.category !== undefined) update.category = patch.category
  if (patch.visibility !== undefined) update.visibility = patch.visibility
  if (patch.versionLabel !== undefined) update.version_label = patch.versionLabel
  if (patch.description !== undefined) update.description = patch.description
  if (patch.status === 'archived') {
    update.status = 'archived'
    update.archived_at = now.toISOString()
    update.archived_by = actor
  } else if (patch.status === 'current') {
    update.status = 'current'
    update.archived_at = null
    update.archived_by = null
  }
  return update
}

async function updateRow(
  clientId: string,
  docId: string,
  update: Record<string, unknown>,
  onlyCurrent: boolean,
): Promise<StoreResult<DocumentRow | null>> {
  if (Object.keys(update).length === 0) return getDocumentById(clientId, docId)
  let query = supabaseAdmin.from(TABLE).update(update).eq('id', docId).eq('client_id', clientId)
  if (onlyCurrent) query = query.eq('status', 'current')
  const { data, error } = await query.select(INTERNAL_COLUMNS).maybeSingle()
  if (error) return fail('patch', error)
  if (data === null) return { ok: true, data: null }
  const updated = toDocumentRow(data, 'all')
  return updated ? { ok: true, data: updated } : malformed('patch')
}

/**
 * Archiving stamps who and when, and only a current row can be archived: a row that is already
 * archived keeps its ORIGINAL stamp (the request is accepted, any other edited fields are applied).
 */
async function archiveWithEdits(
  clientId: string,
  docId: string,
  patch: DocumentPatch,
  actor: string,
): Promise<StoreResult<DocumentRow | null>> {
  const first = await updateRow(clientId, docId, patchToUpdate(patch, actor, new Date()), true)
  if (!first.ok || first.data !== null) return first
  const rest: DocumentPatch = { ...patch }
  delete rest.status
  return updateRow(clientId, docId, patchToUpdate(rest, actor, new Date()), false)
}

export async function patchDocument(
  clientId: string,
  docId: string,
  patch: DocumentPatch,
  actor: string,
): Promise<StoreResult<DocumentRow | null>> {
  if (patch.status === 'archived') return archiveWithEdits(clientId, docId, patch, actor)
  return updateRow(clientId, docId, patchToUpdate(patch, actor, new Date()), false)
}

/** Used by "replace with a new version": only a current row can be archived this way. */
export async function archiveCurrentDocument(
  clientId: string,
  docId: string,
  actor: string,
): Promise<StoreResult<null>> {
  const { error } = await supabaseAdmin
    .from(TABLE)
    .update(patchToUpdate({ status: 'archived' }, actor, new Date()))
    .eq('id', docId)
    .eq('client_id', clientId)
    .eq('status', 'current')
  if (error) return fail('archive', error)
  return { ok: true, data: null }
}
