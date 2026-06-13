/**
 * Theme `text-transform: uppercase` precheck (P12.R.A8).
 *
 * ## Why
 *
 * 2026-06-13 incident: PM pushed ME-generated blog HTML to Oztop's WordPress.
 * The Astra theme ships `text-transform: uppercase` on `.entry-content p`,
 * which silently rendered every paragraph in all-caps. Two earlier posts
 * (2026-05-25 / 2026-05-28) had the same problem and nobody caught it.
 *
 * This module scans the client's WordPress homepage stylesheets for the
 * culprit rule before the FDE hits Publish, so we can surface a non-blocking
 * warning ("Astra forces paragraph uppercase — switch Customizer →
 * Typography → Body → Text Transform to None").
 *
 * ## Design
 *
 * - Fetch homepage HTML, extract every `<link rel="stylesheet">` URL.
 * - Fetch each stylesheet in parallel (capped at 10, 500 KB each, 5 s timeout).
 * - Scan each CSS for `text-transform: uppercase` rules whose selector targets
 *   content paragraphs (`.entry-content p`, `article p`, bare `p`, etc.).
 * - Return matches + per-sheet warnings; never throw on missing CSS.
 *
 * Non-blocking by design — the publish flow continues even if this returns
 * `uppercase: true`. We only WARN the FDE.
 */

import { assertPublicHost } from './ssrf-guard'

// ─── Public types ─────────────────────────────────────────────────────────────

export interface UppercaseMatch {
  /** The exact selector text we matched, e.g. `.entry-content p`. */
  selector: string
  /** Stylesheet URL or `'<inline>'` if found in a `<style>` block on the page. */
  source:   string
}

export interface ThemeUppercaseResult {
  /** True if at least one content-paragraph rule forces uppercase. */
  uppercase: boolean
  /** All matches (may have multiple — different selectors or sheets). */
  matches:   UppercaseMatch[]
  /** Non-fatal issues we hit (sheet fetch failed, malformed CSS, …). */
  warnings:  string[]
}

export interface DetectThemeUppercaseOpts {
  /** Inject for tests. Default: globalThis.fetch. */
  fetchFn?:         typeof fetch
  /** Stylesheet count cap (default 10). */
  maxStylesheets?:  number
  /** Per-sheet byte cap (default 500 KB). Larger sheets are truncated. */
  maxBytesPerSheet?: number
  /** Per-fetch timeout in ms (default 5 000). */
  timeoutMs?:        number
}

// ─── Internal config ──────────────────────────────────────────────────────────

const DEFAULT_MAX_STYLESHEETS    = 10
const DEFAULT_MAX_BYTES_PER_SHEET = 500 * 1024
const DEFAULT_TIMEOUT_MS         = 5_000

/**
 * Selectors that target paragraphs in the article body across the most common
 * WP themes (Astra, GeneratePress, Twenty-Twenty-Whatever, Genesis, Gutenberg
 * default).  We deliberately err on the side of FLAGGING — false-positive
 * warnings are cheap; false-negatives (= caps-in-prod) are expensive.
 */
const CONTENT_PARAGRAPH_PATTERNS: ReadonlyArray<RegExp> = [
  /\.entry-content\s+p\b/i,
  /\.post-content\s+p\b/i,
  /\.site-content\s+p\b/i,
  /\.content-area\s+p\b/i,
  /\.content\s+p\b/i,
  /\.page-content\s+p\b/i,
  /\barticle\s+p\b/i,
  /\bmain\s+p\b/i,
  /\bbody\s+p\b/i,
  /\.wp-block-paragraph\b/i,
  /\.post-entry\s+p\b/i,
  // Bare global "p { … }" — rare in real themes but immediately damaging
  /^\s*p\s*$/i,
]

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * Pull every CSS rule block out of one stylesheet, then return the selectors
 * (split + trimmed) of rules whose body forces `text-transform: uppercase`
 * on what looks like a content paragraph.
 *
 * Side-effect-free; the `source` arg is only stamped on the match metadata.
 */
export function scanCssForUppercase(
  css:    string,
  source: string,
): UppercaseMatch[] {
  const matches: UppercaseMatch[] = []

  // Strip comments first so `/* text-transform: uppercase */` doesn't fire.
  const decommented = css.replace(/\/\*[\s\S]*?\*\//g, '')

  // Iterate every `selector { body }` block.  We avoid the full CSS grammar
  // (no need to handle @media / @supports — they nest blocks of the same
  // shape, which our regex picks up just fine after a flatten pass).
  const blockRe = /([^{}]+)\{([^{}]*)\}/g
  let m: RegExpExecArray | null
  while ((m = blockRe.exec(decommented)) !== null) {
    const selectorList = m[1]
    const body         = m[2]

    if (!/text-transform\s*:\s*uppercase\b/i.test(body)) continue

    // Split the comma-joined selector list and test each one individually.
    for (const raw of selectorList.split(',')) {
      const selector = raw.trim().replace(/\s+/g, ' ')
      if (!selector) continue
      if (CONTENT_PARAGRAPH_PATTERNS.some((re) => re.test(selector))) {
        matches.push({ selector, source })
      }
    }
  }
  return matches
}

/**
 * Extract `<link rel="stylesheet" href="…">` URLs from an HTML page.
 *
 * - Resolves relative paths against `baseUrl`.
 * - Returns unique absolute URLs preserving first-seen order.
 * - Also pulls inline `<style>…</style>` blocks (returned as the literal
 *   string `'<inline>'` so the caller can scan them too).
 *
 * Pure — caller fetches the HTML.
 */
export function extractStylesheetUrls(html: string, baseUrl: string): {
  urls:     string[]
  inlineCss: string[]
} {
  const urls: string[]      = []
  const inlineCss: string[] = []
  const seen = new Set<string>()

  // <link rel="stylesheet" …>  — attribute order is arbitrary; match both rels.
  const linkRe = /<link\b[^>]*?>/gi
  let m: RegExpExecArray | null
  while ((m = linkRe.exec(html)) !== null) {
    const tag = m[0]
    if (!/rel\s*=\s*["']?stylesheet["']?/i.test(tag)) continue
    const hrefMatch = tag.match(/href\s*=\s*["']([^"']+)["']/i)
    if (!hrefMatch) continue
    try {
      const abs = new URL(hrefMatch[1], baseUrl).toString()
      if (!seen.has(abs)) {
        seen.add(abs)
        urls.push(abs)
      }
    } catch {
      // Skip malformed href.
    }
  }

  // <style>…</style> inline blocks
  const styleRe = /<style\b[^>]*>([\s\S]*?)<\/style>/gi
  while ((m = styleRe.exec(html)) !== null) {
    inlineCss.push(m[1])
  }

  return { urls, inlineCss }
}

// ─── Async top-level ──────────────────────────────────────────────────────────

/**
 * Detect whether the client's theme forces paragraph text to uppercase.
 *
 * Network errors / malformed CSS / 4xx responses are folded into `warnings`
 * and never thrown — this is a precheck, not a blocker.
 */
export async function detectThemeUppercase(
  homepageUrl: string,
  opts:        DetectThemeUppercaseOpts = {},
): Promise<ThemeUppercaseResult> {
  const fetchFn          = opts.fetchFn          ?? fetch
  const maxStylesheets   = opts.maxStylesheets   ?? DEFAULT_MAX_STYLESHEETS
  const maxBytesPerSheet = opts.maxBytesPerSheet ?? DEFAULT_MAX_BYTES_PER_SHEET
  const timeoutMs        = opts.timeoutMs        ?? DEFAULT_TIMEOUT_MS

  // Same SSRF guard the rest of cms/* uses — block private / loopback hosts.
  await assertPublicHost(homepageUrl)

  const matches:  UppercaseMatch[] = []
  const warnings: string[]         = []

  // 1. Fetch the homepage HTML.
  let html: string
  try {
    html = await fetchWithTimeout(fetchFn, homepageUrl, timeoutMs, maxBytesPerSheet * 2)
  } catch (err) {
    warnings.push(`Homepage fetch failed: ${errorMessage(err)}`)
    return { uppercase: false, matches: [], warnings }
  }

  const { urls, inlineCss } = extractStylesheetUrls(html, homepageUrl)

  // 2. Scan inline <style> blocks first — cheap and theme-customizer-driven
  //    rules often live here.
  for (const css of inlineCss) {
    matches.push(...scanCssForUppercase(css, '<inline>'))
  }

  // 3. Fetch each external stylesheet (capped, parallel).
  const sheetUrls = urls.slice(0, maxStylesheets)
  if (urls.length > maxStylesheets) {
    warnings.push(
      `Page links ${urls.length} stylesheets; only the first ${maxStylesheets} were scanned.`,
    )
  }

  const sheetResults = await Promise.all(
    sheetUrls.map(async (url) => {
      try {
        const css = await fetchWithTimeout(fetchFn, url, timeoutMs, maxBytesPerSheet)
        return { url, css, error: null as string | null }
      } catch (err) {
        return { url, css: '', error: errorMessage(err) }
      }
    }),
  )

  for (const sheet of sheetResults) {
    if (sheet.error) {
      warnings.push(`Stylesheet fetch failed (${sheet.url}): ${sheet.error}`)
      continue
    }
    matches.push(...scanCssForUppercase(sheet.css, sheet.url))
  }

  return {
    uppercase: matches.length > 0,
    matches,
    warnings,
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function fetchWithTimeout(
  fetchFn:  typeof fetch,
  url:      string,
  timeout:  number,
  maxBytes: number,
): Promise<string> {
  const controller = new AbortController()
  const timer      = setTimeout(() => controller.abort(), timeout)
  try {
    const res = await fetchFn(url, { signal: controller.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const text = await res.text()
    return text.length > maxBytes ? text.slice(0, maxBytes) : text
  } finally {
    clearTimeout(timer)
  }
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.name === 'AbortError' ? 'timeout' : err.message
  return String(err)
}
