/**
 * URL builders for the Page Rewriter (Phase 12.R) UI.
 *
 * Kept as plain pure functions (no React, no Next.js imports) so they can be
 * imported from server-side audit code OR client components, and unit-tested
 * without spinning up the dashboard shell.
 *
 * Reference: docs/superpowers/specs/2026-06-13-phase-12J-wordpress-page-rewriter.md
 */

/**
 * Build the dashboard URL that opens the Page Rewriter pre-wired to a
 * specific Kanban execution_item.
 *
 * Used by M4 — the Kanban card's "在 ME 中改写此页 →" button. When the page
 * rewriter then writes its audit row, `kanban_item_id` becomes the
 * `source_id` on `website_publish_jobs` so the Kanban card can later show
 * a link back to the rewrite job.
 *
 * @param clientId        Client UUID (route segment param)
 * @param executionItemId Kanban execution_items row UUID
 * @param targetUrl       Optional WP permalink to prefill on the lookup screen.
 *                        Pass `null`/`undefined` if unknown — FDE will paste it
 *                        in manually on the lookup screen.
 */
export function pageRewriterUrlForExecutionItem(
  clientId:        string,
  executionItemId: string,
  targetUrl?:      string | null,
): string {
  const cid = encodeURIComponent(clientId)
  const params = new URLSearchParams({ kanban_item_id: executionItemId })
  if (targetUrl && targetUrl.trim().length > 0) {
    params.set('url', targetUrl.trim())
  }
  return `/dashboard/clients/${cid}/page-rewriter?${params.toString()}`
}
