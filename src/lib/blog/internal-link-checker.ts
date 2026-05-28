/**
 * internal-link-checker.ts — P14.B.4
 *
 * Pure function: counts <a href="..."> links in an HTML string that point to
 * the client's own domain (internal links) and returns a structured result
 * that is persisted to blog_posts.quality_check.
 *
 * Pass level thresholds:
 *   ≥ 3 links → pass  (green)
 *   1–2 links → warn  (amber — present but thin)
 *   0 links   → fail  (red   — no internal links at all)
 *
 * The count excludes:
 *  - Fragment-only links (#anchor)
 *  - mailto: / tel: links
 *  - Links to external domains
 *  - Links to /wp-content/ (media files)
 *
 * Side-effect free; safe to import anywhere (no DB, no network).
 */

export interface InternalLinkCheckResult {
  count:       number
  /** 'pass' | 'warn' | 'fail' */
  level:       'pass' | 'warn' | 'fail'
  pass:        boolean
  detail:      string
  computed_at: string
}

/**
 * Count internal links in HTML and return a structured QC result.
 *
 * @param html      - HTML string to analyse
 * @param siteDomain - Client's domain, e.g. "oztopbuildingsupplies.com.au"
 *                    Used to classify a URL as internal vs external.
 *                    If empty/null, ALL absolute http(s) links count as internal.
 */
export function checkInternalLinks(
  html: string,
  siteDomain: string | null,
): InternalLinkCheckResult {
  const normalizedDomain = siteDomain
    ? siteDomain.toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '')
    : null

  // Extract all href values from <a> tags.
  const hrefPattern = /<a[^>]+href=["']([^"']+)["'][^>]*>/gi
  const internalLinks: string[] = []
  let match: RegExpExecArray | null

  while ((match = hrefPattern.exec(html)) !== null) {
    const href = (match[1] ?? '').trim()
    if (!href) continue
    if (isInternalLink(href, normalizedDomain)) {
      internalLinks.push(href)
    }
  }

  // Deduplicate — count unique URL targets, not raw occurrences.
  const unique = [...new Set(internalLinks)]
  const count  = unique.length

  let level: InternalLinkCheckResult['level']
  let detail: string

  if (count >= 3) {
    level  = 'pass'
    detail = `${count} internal link${count === 1 ? '' : 's'} found — SEO signal strong.`
  } else if (count >= 1) {
    level  = 'warn'
    detail = `Only ${count} internal link${count === 1 ? '' : 's'} found — aim for 3–5 to strengthen site authority.`
  } else {
    level  = 'fail'
    detail = 'No internal links found — the generator missed the INTERNAL LINK OPPORTUNITIES block or the pages context was empty.'
  }

  return {
    count,
    level,
    pass:        level === 'pass',
    detail,
    computed_at: new Date().toISOString(),
  }
}

// ─── Private helpers ──────────────────────────────────────────────────────────

function isInternalLink(href: string, normalizedDomain: string | null): boolean {
  // Skip special schemes.
  if (
    href.startsWith('#') ||
    href.startsWith('mailto:') ||
    href.startsWith('tel:') ||
    href.startsWith('javascript:')
  ) return false

  // Relative links (no scheme) are always internal.
  if (!href.startsWith('http://') && !href.startsWith('https://')) return true

  // If no domain filter, all absolute links are internal (no domain known).
  if (!normalizedDomain) return true

  try {
    const url  = new URL(href)
    const host = url.hostname.toLowerCase()

    // Reject media file URLs.
    if (url.pathname.includes('/wp-content/')) return false

    // Match: exact domain or www. subdomain of it.
    return host === normalizedDomain ||
           host === `www.${normalizedDomain}` ||
           normalizedDomain === `www.${host}`
  } catch {
    // Malformed URL — treat as non-link.
    return false
  }
}
