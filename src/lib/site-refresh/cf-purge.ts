/**
 * Purge specific URLs from Cloudflare's edge cache.
 *
 * Uses `CLOUDFLARE_MGMT_TOKEN` (customer-site DNS / Pages management)
 * and `CTS_CLOUDFLARE_ZONE_ID` (the zone id for ctstours.co.nz). Both
 * must be present or the call short-circuits and returns a structured
 * error — we never fall back to purging everything by accident.
 *
 * Cloudflare accepts up to 30 URLs per request; MVP chunks by 25.
 */

export interface CloudflarePurgeResult {
  readonly ok: boolean
  readonly purged: readonly string[]
  readonly errors: readonly string[]
}

const CHUNK = 25

function chunk<T>(arr: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

export async function purgeCloudflarePaths(
  paths: readonly string[],
  opts: {
    origin?: string
    zoneId?: string
    token?: string
    fetcher?: typeof fetch
  } = {},
): Promise<CloudflarePurgeResult> {
  const zoneId = opts.zoneId ?? process.env.CTS_CLOUDFLARE_ZONE_ID
  const token = opts.token ?? process.env.CLOUDFLARE_MGMT_TOKEN
  const origin = opts.origin ?? 'https://www.ctstours.co.nz'
  const fetcher = opts.fetcher ?? fetch

  if (!zoneId || !token) {
    return {
      ok: false,
      purged: [],
      errors: ['CTS_CLOUDFLARE_ZONE_ID or CLOUDFLARE_MGMT_TOKEN missing'],
    }
  }
  if (paths.length === 0) {
    return { ok: true, purged: [], errors: [] }
  }

  const urls = paths.map((p) => `${origin}${p.startsWith('/') ? '' : '/'}${p}`)
  const errors: string[] = []
  const purged: string[] = []

  for (const group of chunk(urls, CHUNK)) {
    try {
      const res = await fetcher(
        `https://api.cloudflare.com/client/v4/zones/${zoneId}/purge_cache`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ files: group }),
        },
      )
      if (!res.ok) {
        errors.push(`HTTP ${res.status} for chunk of ${group.length}`)
        continue
      }
      const body = (await res.json().catch(() => null)) as {
        success?: boolean
        errors?: unknown
      } | null
      if (body?.success === true) {
        purged.push(...group)
      } else {
        errors.push(`CF API returned success=false: ${JSON.stringify(body?.errors ?? body)}`)
      }
    } catch (e) {
      errors.push(`fetch failed: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  return { ok: errors.length === 0, purged, errors }
}
