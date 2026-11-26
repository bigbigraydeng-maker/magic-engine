import type { DocumentStatus, DocumentVisibility } from './constants'

/**
 * One document as the API returns it. Never includes storage_path or the bucket:
 * the browser only ever gets a download URL that goes through the access check.
 */
export interface DocumentRow {
  id: string
  category: string
  title: string
  description: string | null
  version_label: string | null
  visibility: DocumentVisibility
  status: DocumentStatus
  original_filename: string
  mime_type: string
  size_bytes: number
  created_at: string
  // Internal-only columns: absent when the caller is a client member.
  uploaded_by?: string
  replaces_id?: string | null
  archived_at?: string | null
  archived_by?: string | null
}

export interface DocumentListResponse {
  documents: DocumentRow[]
  /** True for Magic Lab internal accounts: the page shows upload / edit / archive. */
  canManage: boolean
}
