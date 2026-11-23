/**
 * SSRF guard for topic_intake.news_feeds — reuses viral URL syntax + DNS checks,
 * fetch uses safeFetchText (redirect-safe, connection-bound).
 */

import Parser from 'rss-parser'
import { safeFetchText } from '@/lib/net/safe-fetch'
import { assertSafeViralSourceUrl, validateViralSourceUrl } from '@/lib/reels/viral-url-guard'
import type { RawFeedItem } from '@/lib/market-intel/types'

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'
const FETCH_TIMEOUT_MS = 15_000

export type NewsFeedUrlCheck = { ok: true; url: string } | { ok: false; reason: string }

/** Sync syntax + literal-IP / internal hostname checks (no DNS). */
export function validateNewsFeedUrl(raw: unknown): NewsFeedUrlCheck {
  const check = validateViralSourceUrl(raw)
  if (!check.ok) return check
  return check
}

/** Syntax + every resolved address must be public. Throws on failure. */
export async function assertSafeNewsFeedUrl(raw: unknown): Promise<string> {
  return assertSafeViralSourceUrl(raw)
}

export class NewsFeedFetchError extends Error {
  constructor(
    public readonly feedUrl: string,
    cause: unknown,
  ) {
    super(`Failed to fetch/parse feed ${feedUrl}: ${cause instanceof Error ? cause.message : String(cause)}`)
    this.name = 'NewsFeedFetchError'
  }
}

/** SSRF-safe RSS fetch (DNS + redirects re-validated each hop). */
export async function fetchNewsFeedItemsSafe(
  feedUrl: string,
  windowHours = 72,
): Promise<RawFeedItem[]> {
  let safeUrl: string
  try {
    safeUrl = await assertSafeNewsFeedUrl(feedUrl)
  } catch (e) {
    throw new NewsFeedFetchError(feedUrl, e)
  }

  let xml: string
  try {
    const res = await safeFetchText(safeUrl, {
      headers: { Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*' },
      userAgent: USER_AGENT,
      timeoutMs: FETCH_TIMEOUT_MS,
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    xml = res.text
  } catch (e) {
    throw new NewsFeedFetchError(feedUrl, e)
  }

  const parser = new Parser()
  let feed: Parser.Output<Record<string, unknown>>
  try {
    feed = await parser.parseString(xml)
  } catch (e) {
    throw new NewsFeedFetchError(feedUrl, e)
  }

  const cutoff = Date.now() - windowHours * 60 * 60 * 1000

  return (feed.items ?? [])
    .filter((entry) => {
      if (!entry.pubDate) return true
      const published = new Date(entry.pubDate).getTime()
      return !Number.isNaN(published) && published >= cutoff
    })
    .map((entry) => ({
      title: (entry.title ?? '').trim(),
      url: entry.link ?? '',
      publishedAt: entry.pubDate ?? null,
      excerpt: (entry.contentSnippet ?? entry.content ?? '').trim().slice(0, 2000),
    }))
    .filter((item) => item.title.length > 0 && item.url.length > 0)
}
