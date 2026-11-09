import { createHash } from 'node:crypto'
import { FILE_TYPES, FILE_TYPES_HINT, MAX_DOCUMENT_BYTES, type FileExtension } from './constants'

/**
 * Upload-side file checks. The server decides the type from the extension and
 * then proves the bytes really are that type; the browser-reported MIME type and
 * the original path are never trusted.
 */

export interface CheckedFile {
  extension: FileExtension
  mimeType: string
  /** Shown in the page and used as the download name. Unicode kept, unsafe characters removed. */
  displayName: string
  /** ASCII-only name used in the storage path. */
  storageName: string
  sha256: string
  sizeBytes: number
}

export type FileCheckResult =
  | { ok: true; file: CheckedFile }
  | { ok: false; status: 400 | 413; error: string }

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

export function extensionOf(name: string): string {
  const match = /\.([A-Za-z0-9]{1,8})$/.exec(name.trim())
  return match ? match[1].toLowerCase() : ''
}

export function isAllowedExtension(extension: string): extension is FileExtension {
  return Object.prototype.hasOwnProperty.call(FILE_TYPES, extension)
}

export function hasValidSignature(extension: FileExtension, head: Buffer): boolean {
  switch (extension) {
    case 'pdf':
      return head.subarray(0, 5).toString('latin1') === '%PDF-'
    case 'docx':
    case 'xlsx':
    case 'pptx':
      // OOXML files are zip containers.
      return head.length >= 4 && head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04
    case 'png':
      return head.length >= 8 && head.subarray(0, 8).equals(PNG_SIGNATURE)
    case 'jpg':
    case 'jpeg':
      return head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff
    case 'webp':
      return head.length >= 12
        && head.subarray(0, 4).toString('latin1') === 'RIFF'
        && head.subarray(8, 12).toString('latin1') === 'WEBP'
  }
}

function stemOf(original: string, extension: string): string {
  const base = (original.replace(/\\/g, '/').split('/').pop() ?? '')
    .normalize('NFKC')
    .replace(/\p{Cc}/gu, '')
    .replace(/["<>|?*:]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  const stem = base.toLowerCase().endsWith(`.${extension}`) ? base.slice(0, -(extension.length + 1)) : base
  return stem.trim().slice(0, 190)
}

/** Name shown to people and used as the download file name. */
export function cleanDisplayName(original: string, extension: string): string {
  return `${stemOf(original, extension) || 'file'}.${extension}`
}

/** ASCII-only file name for the storage path; matches the path CHECK in the migration. */
export function safeStorageName(original: string, extension: string): string {
  const slug = stemOf(original, extension)
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80)
  return `${slug || 'file'}.${extension}`
}

export function checkUploadedFile(originalName: string, bytes: Buffer): FileCheckResult {
  if (bytes.length < 1) return { ok: false, status: 400, error: '文件是空的' }
  if (bytes.length > MAX_DOCUMENT_BYTES) return { ok: false, status: 413, error: '单个文件最大 50 MB' }

  const extension = extensionOf(originalName)
  if (!isAllowedExtension(extension)) {
    return { ok: false, status: 400, error: `不支持这种文件，只收 ${FILE_TYPES_HINT}` }
  }
  if (!hasValidSignature(extension, bytes)) {
    return { ok: false, status: 400, error: '文件内容和扩展名对不上，请确认选的是原文件' }
  }

  return {
    ok: true,
    file: {
      extension,
      mimeType: FILE_TYPES[extension],
      displayName: cleanDisplayName(originalName, extension),
      storageName: safeStorageName(originalName, extension),
      sha256: createHash('sha256').update(bytes).digest('hex'),
      sizeBytes: bytes.length,
    },
  }
}
