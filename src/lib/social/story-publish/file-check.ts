import { createHash } from 'node:crypto'
import type { StoryItemSpec } from './types'

const DEFAULT_TIMEOUT_MS = 20_000
const DEFAULT_MAX_BYTES = 100 * 1024 * 1024

export type MediaFileCheckResult = 'OK' | 'CHANGED' | 'UNREACHABLE'

export interface CheckMediaFileOptions {
  fetcher?: typeof fetch
  timeoutMs?: number
  maxBytes?: number
}

function isHttpsUrl(raw: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    return false
  }
  return parsed.protocol === 'https:'
}

function sha256Hex(bytes: ArrayBuffer): string {
  return createHash('sha256').update(Buffer.from(bytes)).digest('hex')
}

export async function checkMediaFile(
  item: Pick<StoryItemSpec, 'media_url' | 'media_sha256'>,
  options: CheckMediaFileOptions = {},
): Promise<MediaFileCheckResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES

  if (!isHttpsUrl(item.media_url)) {
    return 'UNREACHABLE'
  }

  const fetcher = options.fetcher ?? globalThis.fetch

  let response: Response
  try {
    response = await fetcher(item.media_url, {
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch {
    return 'UNREACHABLE'
  }

  if (!response.ok) {
    return 'UNREACHABLE'
  }

  const contentLength = response.headers.get('content-length')
  if (contentLength !== null) {
    const declared = Number(contentLength)
    if (Number.isFinite(declared) && declared > maxBytes) {
      return 'UNREACHABLE'
    }
  }

  let bytes: ArrayBuffer
  try {
    bytes = await response.arrayBuffer()
  } catch {
    return 'UNREACHABLE'
  }

  if (bytes.byteLength === 0 || bytes.byteLength > maxBytes) {
    return 'UNREACHABLE'
  }

  const actual = sha256Hex(bytes)
  const expected = item.media_sha256.toLowerCase()
  return actual === expected ? 'OK' : 'CHANGED'
}
