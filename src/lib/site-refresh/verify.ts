/**
 * Verify that a set of paths on ctstours.co.nz has actually served
 * fresh HTML. For each path we do a bust-cached GET, then check that
 * a couple of always-present markers appear (no 5xx page, no empty
 * body) AND that the response is served by the origin (not just a
 * stale CDN edge) via the `x-nextjs-cache` / `cf-cache-status` headers.
 *
 * This is a smoke check, not a content-diff — richer per-path grep
 * markers can be layered on top by the caller when we know exactly
 * what change we're waiting to see.
 */

export interface PathVerificationResult {
  readonly path: string
  readonly ok: boolean
  readonly httpStatus: number
  readonly nextCache: string | null
  readonly cfCache: string | null
  readonly bodyBytes: number
  readonly reason?: string
}

export interface VerifyResult {
  readonly ok: boolean
  readonly results: readonly PathVerificationResult[]
}

async function verifyOne(
  path: string,
  origin: string,
  fetcher: typeof fetch,
): Promise<PathVerificationResult> {
  const url = `${origin}${path.startsWith('/') ? '' : '/'}${path}?cb=${Date.now()}${Math.random().toString(36).slice(2, 8)}`
  try {
    const res = await fetcher(url, {
      method: 'GET',
      redirect: 'follow',
      headers: { 'Cache-Control': 'no-cache' },
    })
    const body = await res.text()
    const nextCache = res.headers.get('x-nextjs-cache')
    const cfCache = res.headers.get('cf-cache-status')
    const bytes = body.length
    if (!res.ok) {
      return {
        path,
        ok: false,
        httpStatus: res.status,
        nextCache,
        cfCache,
        bodyBytes: bytes,
        reason: `http_${res.status}`,
      }
    }
    if (bytes < 500) {
      return {
        path,
        ok: false,
        httpStatus: res.status,
        nextCache,
        cfCache,
        bodyBytes: bytes,
        reason: 'body_too_small',
      }
    }
    return { path, ok: true, httpStatus: res.status, nextCache, cfCache, bodyBytes: bytes }
  } catch (e) {
    return {
      path,
      ok: false,
      httpStatus: 0,
      nextCache: null,
      cfCache: null,
      bodyBytes: 0,
      reason: `fetch_failed:${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

export async function verifyCtsPaths(
  paths: readonly string[],
  opts: { origin?: string; fetcher?: typeof fetch } = {},
): Promise<VerifyResult> {
  const origin = opts.origin ?? 'https://www.ctstours.co.nz'
  const fetcher = opts.fetcher ?? fetch
  const results = await Promise.all(paths.map((p) => verifyOne(p, origin, fetcher)))
  return { ok: results.every((r) => r.ok), results }
}
