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

/**
 * Returns an error message, or null on success.
 * cacheControl '0': a private file must not be kept by a CDN for the SDK's default hour, because
 * a cached copy would outlive the 60-second signed link.
 */
export async function uploadDocumentFile(path: string, bytes: Buffer, mimeType: string): Promise<string | null> {
  const { error } = await supabaseAdmin.storage
    .from(DOCUMENTS_BUCKET)
    .upload(path, bytes, { contentType: mimeType, upsert: false, cacheControl: '0' })
  return error ? error.message : null
}

/**
 * Best-effort clean-up. The storage client reports failure in its result instead of throwing,
 * so the result is checked: a leftover object has no row pointing at it (it cannot be
 * downloaded), and its path is logged so it can be removed by hand.
 */
export async function removeDocumentFile(path: string): Promise<void> {
  try {
    const { error } = await supabaseAdmin.storage.from(DOCUMENTS_BUCKET).remove([path])
    if (error) console.error('[client-documents] cleanup failed for', path, error.message)
  } catch (error) {
    console.error('[client-documents] cleanup failed for', path, error instanceof Error ? error.message : error)
  }
}

export type DownloadUrlResult = { ok: true; url: string } | { ok: false; error: string }

/**
 * Put the download file name on a signed URL. The SDK's own `download` option pastes the name
 * into the query string without escaping `&`, `#` or `+`, which cuts the name short, so the
 * name is added here with proper query-string encoding instead.
 */
export function withDownloadName(signedUrl: string, downloadName: string): string {
  const url = new URL(signedUrl)
  url.searchParams.set('download', downloadName)
  return url.toString()
}

export async function createDownloadUrl(path: string, downloadName: string): Promise<DownloadUrlResult> {
  const { data, error } = await supabaseAdmin.storage
    .from(DOCUMENTS_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS)
  if (error || !data?.signedUrl) return { ok: false, error: error?.message ?? 'no signed url' }
  return { ok: true, url: withDownloadName(data.signedUrl, downloadName) }
}
