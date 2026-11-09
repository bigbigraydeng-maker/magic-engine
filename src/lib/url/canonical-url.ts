/**
 * Canonical form of a page URL for cross-source comparison and de-duplication:
 * protocol dropped, leading `www.` dropped, host lowercased, trailing slashes and
 * markdown residue (`**`, `.`, `,`, quotes, `)`) dropped, query and fragment dropped.
 * The path keeps its case (some servers are case-sensitive). Returns null for
 * anything that is not a parseable absolute URL.
 *
 * Moved here from `seo-patrol/page-signals.ts` so shared modules (the kanban card
 * persister) can use the same rule without depending on the patrol.
 *
 * Use it only to compare and de-duplicate. It deliberately merges `www.`/bare hosts
 * and http/https and drops the query string, so it is NOT a page identity: the page
 * ledger uses `site-audit/canonical-inventory/url-rules.ts` (exact and versioned), and
 * per-page Search Console storage keeps its own key.
 */
export function canonicalUrl(raw: string): string | null {
  try {
    const u = new URL(raw)
    const host = u.hostname.toLowerCase().replace(/^www\./, '')
    // Strip trailing slashes AND markdown residue the bare-URL regex drags
    // along (**, ., , etc.) — un-stripped residue makes cross-source URL
    // matching silently fail.
    const path = u.pathname.replace(/[*.,'")]+$/, '').replace(/\/+$/, '') || '/'
    return `${host}${path}`
  } catch {
    return null
  }
}
