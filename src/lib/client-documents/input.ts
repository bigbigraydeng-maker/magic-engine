import {
  MAX_DESCRIPTION_CHARS,
  MAX_TITLE_CHARS,
  MAX_VERSION_LABEL_CHARS,
  DOCUMENT_STATUSES,
  isDocumentCategory,
  isDocumentVisibility,
  type DocumentCategory,
  type DocumentStatus,
  type DocumentVisibility,
} from './constants'

/** Parsing of the text fields that come with an upload or an edit. Pure functions, no I/O. */

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string }

export interface UploadFields {
  title: string
  category: DocumentCategory
  visibility: DocumentVisibility
  versionLabel: string | null
  description: string | null
  replaceId: string | null
}

export interface DocumentPatch {
  title?: string
  category?: DocumentCategory
  visibility?: DocumentVisibility
  versionLabel?: string | null
  description?: string | null
  status?: DocumentStatus
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value)
}

/** Trim, drop control characters (newlines and tabs allowed when `multiline`), empty → null. */
export function cleanText(value: unknown, multiline = false): string | null {
  if (typeof value !== 'string') return null
  const stripped = multiline ? value.replace(/[^\P{Cc}\n\t]/gu, '') : value.replace(/\p{Cc}/gu, ' ')
  const trimmed = stripped.trim()
  return trimmed ? trimmed : null
}

function tooLong(value: string | null, max: number): boolean {
  return value !== null && [...value].length > max
}

function formString(form: FormData, key: string): string | null {
  const value = form.get(key)
  return typeof value === 'string' ? value : null
}

export function parseUploadFields(form: FormData, fallbackTitle: string): ParseResult<UploadFields> {
  const title = cleanText(formString(form, 'title')) ?? cleanText(fallbackTitle)
  if (!title) return { ok: false, error: '请填写文件名称' }
  if (tooLong(title, MAX_TITLE_CHARS)) return { ok: false, error: `名称最多 ${MAX_TITLE_CHARS} 个字` }

  const category = formString(form, 'category') ?? 'other'
  if (!isDocumentCategory(category)) return { ok: false, error: '类别不对' }

  const visibility = formString(form, 'visibility') ?? 'internal'
  if (!isDocumentVisibility(visibility)) return { ok: false, error: '可见范围不对' }

  const versionLabel = cleanText(formString(form, 'versionLabel'))
  if (tooLong(versionLabel, MAX_VERSION_LABEL_CHARS)) return { ok: false, error: `版本号最多 ${MAX_VERSION_LABEL_CHARS} 个字` }

  const description = cleanText(formString(form, 'description'), true)
  if (tooLong(description, MAX_DESCRIPTION_CHARS)) return { ok: false, error: `说明最多 ${MAX_DESCRIPTION_CHARS} 个字` }

  const replaceRaw = cleanText(formString(form, 'replaceId'))
  if (replaceRaw !== null && !isUuid(replaceRaw)) return { ok: false, error: '要替换的文件编号不对' }

  return { ok: true, value: { title, category, visibility, versionLabel, description, replaceId: replaceRaw } }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseTextPatch(body: Record<string, unknown>, patch: DocumentPatch): string | null {
  if ('title' in body) {
    const title = cleanText(body.title)
    if (!title) return '名称不能为空'
    if (tooLong(title, MAX_TITLE_CHARS)) return `名称最多 ${MAX_TITLE_CHARS} 个字`
    patch.title = title
  }
  if ('versionLabel' in body) {
    const label = cleanText(body.versionLabel)
    if (tooLong(label, MAX_VERSION_LABEL_CHARS)) return `版本号最多 ${MAX_VERSION_LABEL_CHARS} 个字`
    patch.versionLabel = label
  }
  if ('description' in body) {
    const description = cleanText(body.description, true)
    if (tooLong(description, MAX_DESCRIPTION_CHARS)) return `说明最多 ${MAX_DESCRIPTION_CHARS} 个字`
    patch.description = description
  }
  return null
}

export function parsePatch(body: unknown): ParseResult<DocumentPatch> {
  if (!isRecord(body)) return { ok: false, error: '请求内容不对' }
  const patch: DocumentPatch = {}

  const textError = parseTextPatch(body, patch)
  if (textError) return { ok: false, error: textError }

  if ('category' in body) {
    if (!isDocumentCategory(body.category)) return { ok: false, error: '类别不对' }
    patch.category = body.category
  }
  if ('visibility' in body) {
    if (!isDocumentVisibility(body.visibility)) return { ok: false, error: '可见范围不对' }
    patch.visibility = body.visibility
  }
  if ('status' in body) {
    const status = body.status
    if (typeof status !== 'string' || !(DOCUMENT_STATUSES as readonly string[]).includes(status)) {
      return { ok: false, error: '状态不对' }
    }
    patch.status = status as DocumentStatus
  }

  if (Object.keys(patch).length === 0) return { ok: false, error: '没有要修改的内容' }
  return { ok: true, value: patch }
}
