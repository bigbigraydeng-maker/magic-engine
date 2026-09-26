/**
 * Turn a page URL returned by Google Search Console into a stable key used to
 * match the same page across days and data sources.
 *
 * The key is persisted (gsc_page_daily.page_key), so changing any rule silently
 * splits old and new rows: a rule change is a key change and needs its own
 * ticket.
 *
 * It is intentionally NOT the same as `canonicalUrl` in
 * `src/lib/seo-patrol/page-signals.ts` (drops the whole query string, used by
 * the patrol) — different purpose, do not merge.
 *
 * It is also not `src/lib/site-audit/canonical-inventory/url-rules.ts`
 * (inventory identity: https only, www not merged), which is why the
 * tracking-parameter list is pinned here on its own.
 *
 * The query string is not dropped entirely: pages such as `/?da_image=8548` are
 * distinct pages; dropping the query would merge them into the home page.
 */

/** Tracking query keys removed from the key (compared case-insensitively). */
export const GSC_PAGE_KEY_TRACKING_KEYS: readonly string[] = ['gclid', 'fbclid', 'msclkid', 'srsltid']
/** Tracking query key prefixes removed from the key (compared case-insensitively). */
export const GSC_PAGE_KEY_TRACKING_PREFIXES: readonly string[] = ['utm_']

export function gscPageKey(raw: string): string | null {
  const input = raw.trim()
  if (input.length === 0) return null

  let u: URL
  try {
    u = new URL(input)
  } catch {
    return null
  }

  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null

  const host = u.hostname.toLowerCase().replace(/^www\./, '')
  if (host.length === 0) return null
  const port = u.port ? `:${u.port}` : ''

  const path = normalisePath(u.pathname)
  const query = normaliseQuery(u.searchParams)

  return `${host}${port}${path}${query}`
}

/** Upper-case percent-escape hex, drop trailing slashes, keep `/` for the root. */
function normalisePath(pathname: string): string {
  const upper = pathname.replace(/%([0-9a-fA-F]{2})/g, (_m, hex: string) => `%${hex.toUpperCase()}`)
  const trimmed = upper.replace(/\/+$/, '')
  return trimmed.length === 0 ? '/' : trimmed
}

/** Drop tracking params, sort the rest by key only (stable), re-encode. */
function normaliseQuery(params: URLSearchParams): string {
  const kept: [string, string][] = []
  params.forEach((value, key) => {
    if (isTrackingKey(key)) return
    kept.push([key, value])
  })
  if (kept.length === 0) return ''

  const sorted = [...kept].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  const joined = sorted.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')
  return `?${joined}`
}

function isTrackingKey(key: string): boolean {
  const lower = key.toLowerCase()
  return (
    GSC_PAGE_KEY_TRACKING_KEYS.includes(lower) ||
    GSC_PAGE_KEY_TRACKING_PREFIXES.some((prefix) => lower.startsWith(prefix))
  )
}
