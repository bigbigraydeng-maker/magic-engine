/**
 * Sitemap ping helpers — P14.E.1
 *
 * Why this file exists:
 *   Google's Indexing API (see `indexing-client.ts`) is officially restricted
 *   to JobPosting / BroadcastEvent pages, so it does not help blog posts at all.
 *   The practical lever we DO have is sitemap recrawl: ping Google + Bing with
 *   the client's sitemap URL right after a PR merge so the search engine
 *   re-fetches the sitemap (which now lists the new post with a fresh lastmod)
 *   and queues a crawl of the new URL.
 *
 * Important caveats:
 *   - Both Google and Bing **deprecated** their unauthenticated sitemap-ping
 *     endpoints in 2023, but the endpoints still work (they 200 or 404 quietly).
 *     We treat this as a best-effort signal: it may help today, will likely
 *     keep working for some time, and even a 404 does not break anything.
 *   - The modern replacement for Bing is IndexNow (POST + key file hosted at
 *     the site root). Migration to IndexNow is tracked under Phase 14.F.
 *   - The modern replacement for Google is GSC Sitemaps API (PUT, needs the
 *     non-readonly `webmasters` scope). Most existing client tokens only
 *     have `webmasters.readonly`, so we cannot use it until they re-auth.
 *     Also tracked under Phase 14.F.
 *
 * This module is intentionally dependency-free and never throws — it is
 * called fire-and-forget from the webhook receiver, which must return 200
 * to GitHub promptly regardless.
 */

const GOOGLE_PING_URL = 'https://www.google.com/ping'
const BING_PING_URL   = 'https://www.bing.com/ping'

const PING_TIMEOUT_MS = 5_000

export interface SitemapPingResult {
  ok:     boolean
  status?: number
  /** Plain-English note for the UI / webhook response. */
  note?:  string
}

export interface SitemapPingSummary {
  sitemapUrl: string
  google:     SitemapPingResult
  bing:       SitemapPingResult
}

/**
 * Ping Google and Bing in parallel with the given sitemap URL. Never throws.
 *
 * @param sitemapUrl - Fully-qualified sitemap URL, e.g. https://www.ctstours.co.nz/sitemap.xml
 */
export async function pingSitemap(sitemapUrl: string): Promise<SitemapPingSummary> {
  const encoded = encodeURIComponent(sitemapUrl)

  const [google, bing] = await Promise.all([
    pingOne(`${GOOGLE_PING_URL}?sitemap=${encoded}`, 'google'),
    pingOne(`${BING_PING_URL}?sitemap=${encoded}`,   'bing'),
  ])

  return { sitemapUrl, google, bing }
}

async function pingOne(url: string, engine: 'google' | 'bing'): Promise<SitemapPingResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PING_TIMEOUT_MS)
  try {
    const res = await fetch(url, { method: 'GET', signal: controller.signal })
    return {
      ok:     res.ok,
      status: res.status,
      note:   engine === 'google'
        ? 'Google deprecated this endpoint 2023-06 but it still responds — use GSC Sitemaps API for the long-term path.'
        : 'Bing deprecated this endpoint 2023 — migrate to IndexNow for the long-term path.',
    }
  } catch (err) {
    return {
      ok:   false,
      note: err instanceof Error && err.name === 'AbortError'
        ? `${engine} ping timed out after ${PING_TIMEOUT_MS}ms`
        : `${engine} ping failed: ${err instanceof Error ? err.message : 'unknown error'}`,
    }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Build the canonical sitemap URL for a client given their domain.
 * Returns null if the domain is empty / malformed.
 */
export function buildSitemapUrlFromDomain(domain: string | null | undefined): string | null {
  const trimmed = (domain ?? '').trim()
  if (!trimmed) return null
  const base = trimmed.startsWith('http') ? trimmed : `https://${trimmed}`
  return `${base.replace(/\/$/, '')}/sitemap.xml`
}
