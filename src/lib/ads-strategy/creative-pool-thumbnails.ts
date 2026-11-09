/**
 * Live thumbnails for creative-pool videos (read-only, never stored).
 *
 * Meta thumbnail URLs are signed and expire, so they are fetched on every page
 * load and never written to the database. Every failure is soft: an id that
 * cannot be read is simply absent and the UI shows a grey placeholder.
 */

import { getMetaTokenForClient } from '@/lib/meta/token-manager'

const GRAPH_BASE = 'https://graph.facebook.com/v21.0'
const REQUEST_TIMEOUT_MS = 6_000
const MAX_ENTRIES = 40

export interface CreativeThumbnail {
  thumbnailUrl: string | null
  /** Title set on the video in Meta, when there is one. */
  title: string | null
  durationSeconds: number | null
}

export interface ThumbnailEntryInput {
  ref: string
  alias_refs?: string[]
}

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>

const isNumericId = (id: string): boolean => /^\d+$/.test(id)

/** Exact id first, then numeric aliases (a work-order ref has no Meta id of its own). */
export function candidateVideoIds(entry: ThumbnailEntryInput): string[] {
  const ids = [entry.ref, ...(entry.alias_refs ?? [])].filter(isNumericId)
  return Array.from(new Set(ids))
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null
}

/** Pick the preferred thumbnail, else the first one, else the plain `picture`. */
export function pickThumbnailUrl(body: Record<string, unknown>): string | null {
  const thumbs = (body.thumbnails as { data?: unknown } | undefined)?.data
  if (Array.isArray(thumbs)) {
    const rows = thumbs.filter((t): t is Record<string, unknown> => !!t && typeof t === 'object')
    const preferred = rows.find(t => t.is_preferred === true && str(t.uri))
    const uri = str((preferred ?? rows.find(t => str(t.uri)))?.uri)
    if (uri) return uri
  }
  return str(body.picture)
}

async function readVideo(videoId: string, token: string, fetchFn: FetchFn): Promise<CreativeThumbnail | null> {
  const params = new URLSearchParams({ fields: 'picture,thumbnails{uri,is_preferred},title,length' })
  try {
    const res = await fetchFn(`${GRAPH_BASE}/${videoId}?${params}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (!res.ok) return null
    const body = (await res.json()) as unknown
    if (!body || typeof body !== 'object' || Array.isArray(body)) return null
    const rec = body as Record<string, unknown>
    const length = typeof rec.length === 'number' && Number.isFinite(rec.length) && rec.length > 0 ? rec.length : null
    const out: CreativeThumbnail = {
      thumbnailUrl: pickThumbnailUrl(rec),
      title: str(rec.title),
      durationSeconds: length === null ? null : Math.round(length),
    }
    return out.thumbnailUrl || out.title || out.durationSeconds ? out : null
  } catch {
    return null
  }
}

/** Keyed by the pool entry's `ref`. Entries Meta cannot answer for are absent. */
export async function loadCreativeThumbnails(
  clientId: string,
  entries: ThumbnailEntryInput[],
  fetchFn: FetchFn = fetch,
): Promise<Record<string, CreativeThumbnail>> {
  const wanted = entries.slice(0, MAX_ENTRIES).filter(e => candidateVideoIds(e).length > 0)
  if (wanted.length === 0) return {}
  let token: string | null = null
  try {
    token = await getMetaTokenForClient(clientId)
  } catch {
    return {}
  }
  if (!token) return {}
  const accessToken = token

  const found = await Promise.all(
    wanted.map(async (entry): Promise<[string, CreativeThumbnail | null]> => {
      for (const id of candidateVideoIds(entry)) {
        const hit = await readVideo(id, accessToken, fetchFn)
        if (hit) return [entry.ref, hit]
      }
      return [entry.ref, null]
    }),
  )
  const out: Record<string, CreativeThumbnail> = {}
  for (const [ref, hit] of found) if (hit) out[ref] = hit
  return out
}
