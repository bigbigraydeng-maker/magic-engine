/**
 * Which URLs get crawled when the site has more pages than the per-run cap.
 *
 * 🔴 2026-10-05 CTS: sitemap listed 179 pages, the weekly cap was 150, and the
 *    cap was applied with `urls.slice(0, cap)` in sitemap order — so the same
 *    tail pages were dropped every single week. Their rows stayed
 *    crawl_status='crawled' with no error, so nothing showed they were stale.
 *    Ordering stalest-first turns a permanent blind spot into a rotation.
 */

/** Same page, different spelling: trailing slash and host case must not break the match. */
export function crawlKey(url: string): string {
  try {
    const u = new URL(url)
    const path = u.pathname.length > 1 ? u.pathname.replace(/\/+$/, '') : ''
    return `${u.hostname.toLowerCase()}${path}${u.search}`
  } catch {
    return url
  }
}

/**
 * Never-crawled URLs first (sitemap order kept), then by oldest crawled_at.
 * Stable: ties keep sitemap order. Pure — callers supply the crawled_at map.
 */
export function orderStalestFirst(
  urls: readonly string[],
  crawledAtByUrl: ReadonlyMap<string, string>,
): string[] {
  const keyed = new Map<string, string>()
  for (const [url, at] of crawledAtByUrl) keyed.set(crawlKey(url), at)
  return urls
    .map((url, index) => ({ url, index, at: keyed.get(crawlKey(url)) }))
    .sort((a, b) => {
      if (a.at === undefined && b.at === undefined) return a.index - b.index
      if (a.at === undefined) return -1
      if (b.at === undefined) return 1
      return a.at < b.at ? -1 : a.at > b.at ? 1 : a.index - b.index
    })
    .map((x) => x.url)
}

/** Human-readable note for the job row when the cap left pages unrefreshed; null when none. */
export function summarizeCapSkips(discovered: number, cap: number): string | null {
  if (discovered <= cap) return null
  return `本轮发现 ${discovered} 页，上限 ${cap} 页，有 ${discovered - cap} 页这轮没刷新（已按最久没刷新的优先，下一轮轮到它们）`
}
