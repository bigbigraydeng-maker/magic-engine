import { isDocumentVisibility, DOCUMENT_STATUSES, type DocumentStatus } from './constants'
import type { DocumentScope } from './access'
import type { DocumentRow } from './types'

/**
 * Turns raw database rows into the shapes the API may return. Each mapper copies only the
 * whitelisted columns, so a column added to the table (or to a select list) later can never
 * leak to the browser by accident: storage_path in particular only ever leaves via DownloadTarget.
 */

export interface DownloadTarget {
  id: string
  storage_path: string
  original_filename: string
}

export interface IdTitle {
  id: string
  title: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function isStatus(value: unknown): value is DocumentStatus {
  return typeof value === 'string' && (DOCUMENT_STATUSES as readonly string[]).includes(value)
}

/** PostgREST sends bigint as a JSON number; accept a numeric string too. */
function byteCount(value: unknown): number | null {
  const parsed = typeof value === 'string' ? Number(value) : value
  return typeof parsed === 'number' && Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

export function toDocumentRow(raw: unknown, scope: DocumentScope): DocumentRow | null {
  if (!isRecord(raw)) return null
  const id = text(raw.id)
  const category = text(raw.category)
  const title = text(raw.title)
  const originalFilename = text(raw.original_filename)
  const mimeType = text(raw.mime_type)
  const createdAt = text(raw.created_at)
  const sizeBytes = byteCount(raw.size_bytes)
  const { visibility, status } = raw
  if (
    id === null || category === null || title === null || originalFilename === null ||
    mimeType === null || createdAt === null || sizeBytes === null ||
    !isDocumentVisibility(visibility) || !isStatus(status)
  ) return null

  const row: DocumentRow = {
    id,
    category,
    title,
    description: text(raw.description),
    version_label: text(raw.version_label),
    visibility,
    status,
    original_filename: originalFilename,
    mime_type: mimeType,
    size_bytes: sizeBytes,
    created_at: createdAt,
  }
  if (scope === 'all') {
    const uploadedBy = text(raw.uploaded_by)
    if (uploadedBy !== null) row.uploaded_by = uploadedBy
    row.replaces_id = text(raw.replaces_id)
    row.archived_at = text(raw.archived_at)
    row.archived_by = text(raw.archived_by)
  }
  return row
}

export function toDocumentRows(raw: unknown, scope: DocumentScope): DocumentRow[] | null {
  if (!Array.isArray(raw)) return null
  const rows = raw.map(item => toDocumentRow(item, scope))
  return rows.every((row): row is DocumentRow => row !== null) ? rows : null
}

export function toDownloadTarget(raw: unknown): DownloadTarget | null {
  if (!isRecord(raw)) return null
  const id = text(raw.id)
  const storagePath = text(raw.storage_path)
  const originalFilename = text(raw.original_filename)
  if (id === null || storagePath === null || originalFilename === null) return null
  return { id, storage_path: storagePath, original_filename: originalFilename }
}

export function toIdTitle(raw: unknown): IdTitle | null {
  if (!isRecord(raw)) return null
  const id = text(raw.id)
  const title = text(raw.title)
  return id !== null && title !== null ? { id, title } : null
}
