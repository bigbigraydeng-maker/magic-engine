/**
 * Story "lite" — the pre-send check for a VIDEO story: the file is downloaded once, its hash is compared with
 * the registered one, and the clip itself is inspected (length, upright shape, size). Pictures keep using
 * `checkMediaFile`; this is only for items whose media is a video.
 */
import { createHash } from 'node:crypto'

import { inspectMp4, judgeVideo } from './video-inspect'
import type { LiteFileCheck, LiteItem } from './types'

const DEFAULT_TIMEOUT_MS = 60_000
const DEFAULT_MAX_BYTES = 100 * 1024 * 1024

export interface CheckVideoFileOptions {
  allowedHosts: string[]
  fetcher?: typeof fetch
  timeoutMs?: number
  maxBytes?: number
}

function hostAllowed(host: string, allowed: string[]): boolean {
  const lower = host.toLowerCase()
  return allowed.some((entry) => lower === entry.toLowerCase() || lower.endsWith(`.${entry.toLowerCase()}`))
}

/** Read the body without holding more than `maxBytes`; null when empty, too large or unreadable. */
async function readBody(response: Response, maxBytes: number): Promise<Uint8Array | null> {
  try {
    if (!response.body) {
      const bytes = new Uint8Array(await response.arrayBuffer())
      return bytes.length === 0 || bytes.length > maxBytes ? null : bytes
    }
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let total = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined)
        return null
      }
      chunks.push(value)
    }
    if (total === 0) return null
    const all = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) {
      all.set(chunk, offset)
      offset += chunk.byteLength
    }
    return all
  } catch {
    return null
  }
}

export async function checkVideoFile(
  item: Pick<LiteItem, 'media_url' | 'media_sha256'>,
  options: CheckVideoFileOptions,
): Promise<LiteFileCheck> {
  let url: URL
  try {
    url = new URL(item.media_url)
  } catch {
    return 'UNREACHABLE'
  }
  if (url.protocol !== 'https:' || !hostAllowed(url.hostname, options.allowedHosts)) return 'UNREACHABLE'

  const fetcher = options.fetcher ?? globalThis.fetch
  let response: Response
  try {
    response = await fetcher(item.media_url, {
      redirect: 'error',
      cache: 'no-store',
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    })
  } catch {
    return 'UNREACHABLE'
  }
  if (!response.ok) return 'UNREACHABLE'

  const bytes = await readBody(response, options.maxBytes ?? DEFAULT_MAX_BYTES)
  if (bytes === null) return 'UNREACHABLE'

  const hash = createHash('sha256').update(bytes).digest('hex')
  if (hash !== item.media_sha256.toLowerCase()) return 'CHANGED'

  const facts = inspectMp4(bytes)
  if (facts === null) return 'BAD_VIDEO'
  return judgeVideo(facts) === null ? 'OK' : 'BAD_VIDEO'
}
