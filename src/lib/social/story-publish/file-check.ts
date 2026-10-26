import { createHash } from 'node:crypto'
import type { StoryItemSpec } from './types'

const DEFAULT_TIMEOUT_MS = 20_000
const DEFAULT_MAX_BYTES = 100 * 1024 * 1024

export type MediaFileCheckResult = 'OK' | 'CHANGED' | 'UNREACHABLE'

export interface CheckMediaFileOptions {
  fetcher?: typeof fetch
  timeoutMs?: number
  maxBytes?: number
  /**
   * Hosts the media may live on (exact host or any subdomain). When given, any other host is
   * UNREACHABLE without a request, and an empty list denies everything — this keeps the check from
   * being used to probe internal addresses. Leave unset only in tests.
   */
  allowedHosts?: string[]
}

function parseHttpsUrl(raw: string): URL | null {
  try {
    const parsed = new URL(raw)
    return parsed.protocol === 'https:' ? parsed : null
  } catch {
    return null
  }
}

function hostAllowed(host: string, allowed: string[]): boolean {
  const lower = host.toLowerCase()
  return allowed.some((entry) => {
    const rule = entry.toLowerCase()
    return lower === rule || lower.endsWith(`.${rule}`)
  })
}

/**
 * Hash the body without ever holding more than `maxBytes` (a chunked or compressed response has no
 * trustworthy content-length). Returns null when the body is empty, too large or unreadable.
 */
async function hashBody(response: Response, maxBytes: number): Promise<string | null> {
  const hash = createHash('sha256')
  let total = 0
  try {
    if (!response.body) {
      const bytes = await response.arrayBuffer()
      if (bytes.byteLength === 0 || bytes.byteLength > maxBytes) return null
      return hash.update(Buffer.from(bytes)).digest('hex')
    }
    const reader = response.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined)
        return null
      }
      hash.update(value)
    }
  } catch {
    return null
  }
  return total === 0 ? null : hash.digest('hex')
}

export async function checkMediaFile(
  item: Pick<StoryItemSpec, 'media_url' | 'media_sha256'>,
  options: CheckMediaFileOptions = {},
): Promise<MediaFileCheckResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES

  const url = parseHttpsUrl(item.media_url)
  if (url === null) return 'UNREACHABLE'
  if (options.allowedHosts !== undefined && !hostAllowed(url.hostname, options.allowedHosts)) {
    return 'UNREACHABLE'
  }

  const fetcher = options.fetcher ?? globalThis.fetch
  let response: Response
  try {
    response = await fetcher(item.media_url, {
      redirect: 'error',
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch {
    return 'UNREACHABLE'
  }
  if (!response.ok) return 'UNREACHABLE'

  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) return 'UNREACHABLE'

  const actual = await hashBody(response, maxBytes)
  if (actual === null) return 'UNREACHABLE'
  return actual === item.media_sha256.toLowerCase() ? 'OK' : 'CHANGED'
}
