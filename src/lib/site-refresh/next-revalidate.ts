/**
 * Ask chinatravel's Next.js app to blow specific paths out of its
 * Full Route Cache. This calls the `/api/revalidate` endpoint that
 * lives in the chinatravel repo (added there in a separate PR), gated
 * by a Bearer token that must match its `REVALIDATE_SECRET` env var
 * (mirrored here as `CTS_REVALIDATE_SECRET`).
 *
 * We call one path per request — the chinatravel endpoint takes
 * `?path=` and revalidates that single path.
 */

export interface NextRevalidateResult {
  readonly ok: boolean
  readonly revalidated: readonly string[]
  readonly errors: readonly string[]
}

export async function revalidateCtsPaths(
  paths: readonly string[],
  opts: {
    origin?: string
    secret?: string
    fetcher?: typeof fetch
  } = {},
): Promise<NextRevalidateResult> {
  const secret = opts.secret ?? process.env.CTS_REVALIDATE_SECRET
  const origin = opts.origin ?? 'https://www.ctstours.co.nz'
  const fetcher = opts.fetcher ?? fetch

  if (!secret) {
    return {
      ok: false,
      revalidated: [],
      errors: ['CTS_REVALIDATE_SECRET missing'],
    }
  }
  if (paths.length === 0) {
    return { ok: true, revalidated: [], errors: [] }
  }

  const revalidated: string[] = []
  const errors: string[] = []

  for (const p of paths) {
    try {
      const res = await fetcher(
        `${origin}/api/revalidate?path=${encodeURIComponent(p)}`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${secret}` },
        },
      )
      if (!res.ok) {
        errors.push(`HTTP ${res.status} for ${p}`)
        continue
      }
      revalidated.push(p)
    } catch (e) {
      errors.push(`fetch failed for ${p}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  return { ok: errors.length === 0, revalidated, errors }
}
