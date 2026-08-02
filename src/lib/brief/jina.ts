/**
 * Jina.ai Reader API — URL to clean Markdown
 * Free, no API key, handles JS-rendered pages.
 * https://jina.ai/reader/
 */

export interface JinaFetchResult {
  url: string
  title: string
  markdown: string
  chars: number
}

const MAX_CHARS = 30_000   // ~7.5K tokens — prevents context explosion
const RAW_MAX_CHARS = 1_000_000  // fetchUrlRaw cap — sitemaps can be hundreds of KB
const TIMEOUT_MS = 15_000  // 15s per attempt — faster fallback for non-existent pages
const MAX_RETRIES = 2       // 2 attempts max — total wait ≤ 31s before fallback

/**
 * Core Jina Reader fetch with retry/backoff. Returns the raw response body.
 */
async function jinaFetch(url: string, returnFormat: 'markdown' | 'html'): Promise<string> {
  // Jina Reader expects the raw URL appended to the base path — no encoding.
  const jinaUrl = `https://r.jina.ai/${url}`

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

      // Optional API key lifts the anonymous ~20 RPM tier that caused CTS's
      // structural 429 failures (10/30 pages, 2026-05). Works without it.
      const jinaKey = process.env.JINA_API_KEY
      const res = await fetch(jinaUrl, {
        headers: {
          'Accept': 'text/plain',
          'X-Return-Format': returnFormat,
          ...(jinaKey ? { Authorization: `Bearer ${jinaKey}` } : {}),
        },
        signal: controller.signal,
      })
      clearTimeout(timer)

      if (!res.ok) {
        throw new JinaError(`HTTP ${res.status}`, url, res.status)
      }

      const raw = await res.text()
      if (!raw || raw.trim().length === 0) {
        throw new JinaError('Empty response', url, res.status)
      }

      return raw

    } catch (err) {
      if (err instanceof JinaError) throw err

      const isAbort = err instanceof Error && err.name === 'AbortError'
      const isLastAttempt = attempt === MAX_RETRIES - 1

      if (isLastAttempt) {
        throw new JinaError(
          isAbort ? 'Timeout after 30s' : `Network error: ${(err as Error).message}`,
          url
        )
      }

      // Exponential backoff: 1s, 2s, 4s
      await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 1000))
    }
  }

  throw new JinaError('Max retries exceeded', url)
}

/**
 * Fetch a URL and return clean Markdown via Jina Reader.
 * Truncates content to MAX_CHARS to keep Claude token usage bounded.
 */
export async function fetchUrlAsMarkdown(url: string): Promise<JinaFetchResult> {
  const raw = await jinaFetch(url, 'markdown')

  // Extract title from first H1 or use URL
  const titleMatch = raw.match(/^#\s+(.+)$/m)
  const title = titleMatch?.[1] ?? new URL(url).hostname

  // Truncate to prevent token explosion
  const markdown = raw.length > MAX_CHARS
    ? raw.slice(0, MAX_CHARS) + '\n\n[Content truncated for processing]'
    : raw

  return { url, title, markdown, chars: markdown.length }
}

/**
 * Fetch a URL via Jina Reader without the 30K truncation or title handling.
 * Used for sitemap discovery on WAF-blocked domains — Jina's default render
 * pipeline follows challenge redirects (e.g. SiteGround sgcaptcha meta-refresh)
 * that both direct fetch and X-Return-Format: html get stuck on (verified
 * against oztopbuildingsupplies.com.au, 2026-08-01). Sitemap URLs survive as
 * markdown links and are extracted by regex, so the markdown conversion is
 * fine; the higher cap matters because sitemaps can be hundreds of KB.
 */
export async function fetchUrlRaw(url: string): Promise<string> {
  const raw = await jinaFetch(url, 'markdown')
  return raw.length > RAW_MAX_CHARS ? raw.slice(0, RAW_MAX_CHARS) : raw
}

/**
 * Fetch multiple URLs, silently skipping failures.
 * Returns only successful results so one bad URL doesn't block generation.
 */
export async function fetchMultipleUrls(
  urls: string[]
): Promise<{ results: JinaFetchResult[]; errors: Array<{ url: string; error: string }> }> {
  const settled = await Promise.allSettled(urls.map(fetchUrlAsMarkdown))

  const results: JinaFetchResult[] = []
  const errors: Array<{ url: string; error: string }> = []

  settled.forEach((outcome, i) => {
    if (outcome.status === 'fulfilled') {
      results.push(outcome.value)
    } else {
      errors.push({ url: urls[i], error: outcome.reason?.message ?? 'Unknown error' })
    }
  })

  return { results, errors }
}

export class JinaError extends Error {
  constructor(
    message: string,
    public readonly url: string,
    public readonly statusCode?: number
  ) {
    super(`Jina fetch failed for ${url}: ${message}`)
    this.name = 'JinaError'
  }
}
