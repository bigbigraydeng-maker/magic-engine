/**
 * Client document library — shared constants.
 *
 * Imported by the API routes, the dashboard page and the tests, so it must stay
 * free of server-only imports (the page is a client component).
 * Keep MAX_DOCUMENT_BYTES, the bucket name and FILE_TYPES in sync with
 * supabase/migrations/20261110140000_client_documents.sql (a contract test checks it).
 */

export const DOCUMENTS_BUCKET = 'me-client-documents'
export const MAX_DOCUMENT_BYTES = 50 * 1024 * 1024
/** A fresh signed link is made per click; it only has to outlive the redirect. */
export const SIGNED_URL_TTL_SECONDS = 60
export const LIST_LIMIT = 500

export const MAX_TITLE_CHARS = 200
export const MAX_VERSION_LABEL_CHARS = 40
export const MAX_DESCRIPTION_CHARS = 1000

/** Industry-neutral on purpose: tour-specific wording belongs in the title, not here. */
export const DOCUMENT_CATEGORIES = [
  { key: 'brochure', label: '手册 / 画册' },
  { key: 'sheet', label: '单页资料' },
  { key: 'price', label: '价格与团期' },
  { key: 'brand', label: '品牌资料' },
  { key: 'contract', label: '合同与协议' },
  { key: 'other', label: '其他' },
] as const

export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number]['key']

export const CATEGORY_KEYS: readonly string[] = DOCUMENT_CATEGORIES.map(category => category.key)

export function isDocumentCategory(value: unknown): value is DocumentCategory {
  return typeof value === 'string' && CATEGORY_KEYS.includes(value)
}

export function categoryLabel(key: string): string {
  return DOCUMENT_CATEGORIES.find(category => category.key === key)?.label ?? '其他'
}

export const DOCUMENT_VISIBILITIES = ['internal', 'client'] as const
export type DocumentVisibility = (typeof DOCUMENT_VISIBILITIES)[number]

export const VISIBILITY_LABELS: Record<DocumentVisibility, string> = {
  internal: '仅 Magic Lab 内部',
  client: '客户员工也能下载',
}

export const DOCUMENT_STATUSES = ['current', 'archived'] as const
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number]

export function isDocumentVisibility(value: unknown): value is DocumentVisibility {
  return value === 'internal' || value === 'client'
}

/** Extension → MIME type. The server decides the type; the browser-reported one is ignored. */
export const FILE_TYPES = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
} as const

export type FileExtension = keyof typeof FILE_TYPES

export const ACCEPT_ATTRIBUTE = Object.keys(FILE_TYPES).map(extension => `.${extension}`).join(',')
export const FILE_TYPES_HINT = 'PDF、Word、Excel、PowerPoint、PNG、JPG、WebP'
