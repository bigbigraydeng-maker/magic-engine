/**
 * Normalise a page URL or path to a path-only string for cross-source matching.
 *
 *   "https://example.com/blog/foo"  → "/blog/foo"
 *   "/blog/foo?utm=x"                → "/blog/foo"
 *   "/blog/foo#section"              → "/blog/foo"
 *   "/blog/foo/"                     → "/blog/foo"
 *   "/"                              → "/"
 *
 * GSC returns full URLs; GA4 returns paths. We need them aligned so we can
 * merge per-page metrics across sources and snapshots.
 */
export function normalisePath(input: string): string {
  if (!input) return ''
  let path = input
  try {
    if (path.startsWith('http')) {
      path = new URL(path).pathname
    }
  } catch {
    // not a valid URL, keep as-is
  }
  // strip query string
  const qIdx = path.indexOf('?')
  if (qIdx >= 0) path = path.substring(0, qIdx)
  // strip fragment
  const hIdx = path.indexOf('#')
  if (hIdx >= 0) path = path.substring(0, hIdx)
  // strip trailing slash (except for root)
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1)
  return path
}
