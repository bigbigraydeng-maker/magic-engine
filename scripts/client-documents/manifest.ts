import path from 'node:path'
import {
  isDocumentCategory,
  isDocumentVisibility,
  type DocumentCategory,
  type DocumentVisibility,
} from '../../src/lib/client-documents/constants'

/**
 * The list of files to put into a client's document library, as the import script reads it.
 * Category and visibility are REQUIRED on every entry: who may download a file is a decision,
 * so the operator has to write it down instead of inheriting a default.
 */

export interface ManifestEntry {
  /** Absolute path (relative paths are resolved against the manifest's folder). */
  path: string
  title: string | null
  category: DocumentCategory
  visibility: DocumentVisibility
  versionLabel: string | null
  description: string | null
}

export type ManifestResult =
  | { ok: true; entries: ManifestEntry[] }
  | { ok: false; errors: string[] }

const MAX_ENTRIES = 50

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function optionalText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function parseEntry(raw: unknown, index: number, baseDir: string): ManifestEntry | string[] {
  const label = `files[${index}]`
  if (!isRecord(raw)) return [`${label}: must be an object`]
  const errors: string[] = []

  const filePath = optionalText(raw.path)
  if (!filePath) errors.push(`${label}: "path" is required`)
  if (!isDocumentCategory(raw.category)) errors.push(`${label}: "category" must be one of the library categories`)
  if (!isDocumentVisibility(raw.visibility)) errors.push(`${label}: "visibility" must be "internal" or "client" (no default on purpose)`)
  if (errors.length > 0 || !filePath || !isDocumentCategory(raw.category) || !isDocumentVisibility(raw.visibility)) return errors

  return {
    path: path.resolve(baseDir, filePath),
    title: optionalText(raw.title),
    category: raw.category,
    visibility: raw.visibility,
    versionLabel: optionalText(raw.versionLabel),
    description: optionalText(raw.description),
  }
}

export function parseManifest(raw: unknown, baseDir: string): ManifestResult {
  if (!isRecord(raw) || !Array.isArray(raw.files)) return { ok: false, errors: ['manifest must be {"files": [...]}'] }
  if (raw.files.length < 1 || raw.files.length > MAX_ENTRIES) {
    return { ok: false, errors: [`"files" must hold 1 to ${MAX_ENTRIES} entries`] }
  }

  const entries: ManifestEntry[] = []
  const errors: string[] = []
  raw.files.forEach((item: unknown, index: number) => {
    const parsed = parseEntry(item, index, baseDir)
    if (Array.isArray(parsed)) errors.push(...parsed)
    else entries.push(parsed)
  })

  const seen = new Set<string>()
  for (const entry of entries) {
    if (seen.has(entry.path)) errors.push(`duplicate path: ${entry.path}`)
    seen.add(entry.path)
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, entries }
}
