import { supabaseAdmin } from '@/lib/supabase'
import { DOCUMENTS_BUCKET, SIGNED_URL_TTL_SECONDS } from './constants'

/**
 * Storage side of the document library. The bucket is private and has no storage policies:
 * only the server (service role) can read or write it. The bucket is created by the migration;
 * nothing here creates it at runtime, so a missing bucket fails loudly instead of silently
 * creating one with the wrong settings.
 */

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const PATH_RE = new RegExp(`^(${UUID})/(${UUID})/[A-Za-z0-9_-][A-Za-z0-9._-]{0,119}$`)

export function buildStoragePath(clientId: string, docId: string, storageName: string): string {
  return `${clientId.toLowerCase()}/${docId.toLowerCase()}/${storageName}`
}

/** True only for `<clientId>/<docId>/<safe name>`; checked again right before a link is signed. */
export function pathBelongsTo(path: string, clientId: string, docId: string): boolean {
  const match = PATH_RE.exec(path)
  return match !== null && match[1] === clientId.toLowerCase() && match[2] === docId.toLowerCase()
}

/** Returns an error message, or null on success. */
export async function uploadDocumentFile(path: string, bytes: Buffer, mimeType: string): Promise<string | null> {
  const { error } = await supabaseAdmin.storage
    .from(DOCUMENTS_BUCKET)
    .upload(path, bytes, { contentType: mimeType, upsert: false })
  return error ? error.message : null
}

export async function removeDocumentFile(path: string): Promise<void> {
  try {
    await supabaseAdmin.storage.from(DOCUMENTS_BUCKET).remove([path])
  } catch (error) {
    // A leftover object has no row pointing at it, so it cannot be downloaded; log the path for cleanup.
    console.error('[client-documents] cleanup failed for', path, error instanceof Error ? error.message : error)
  }
}

export type DownloadUrlResult = { ok: true; url: string } | { ok: false; error: string }

export async function createDownloadUrl(path: string, downloadName: string): Promise<DownloadUrlResult> {
  const { data, error } = await supabaseAdmin.storage
    .from(DOCUMENTS_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS, { download: downloadName })
  if (error || !data?.signedUrl) return { ok: false, error: error?.message ?? 'no signed url' }
  return { ok: true, url: data.signedUrl }
}
