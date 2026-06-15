-- ════════════════════════════════════════════════════════════════════════════
-- Phase 12.R · B7 — Backfill blog_posts.geo_html_snapshot from V1 to V2 format
-- ════════════════════════════════════════════════════════════════════════════
--
-- Background:
--   V1 geo_html_snapshot relies on a single `style="position: absolute;
--   top: -9999px"` inline attribute. WordPress Gutenberg / Classic editor /
--   Elementor strip inline positioning styles on paste, leaving the AI-
--   instruction block visible to end users.
--
--   2026-06-13 04:53 NZST — Oztop client-site P0 incident: published blog
--   showed visible "[INSTRUCTIONS FOR AI AGENTS] ..." text after a Copy-HTML
--   → WP paste flow.
--
--   Affected: ~20+ rows (oztop + CTS Tours NZ) — all blog_posts produced
--   before this fix landed.
--
-- Strategy:
--   Wrap each legacy V1 snapshot in a V2 outer div that carries the `hidden`
--   HTML boolean attribute + a sibling <style> block. This is safer than
--   re-running GEO Composer because:
--     1. Doesn't require token spend on Claude/GPT
--     2. Preserves exact instruction text (no AI-generated drift)
--     3. Idempotent — re-running on a V2 snapshot is a no-op
--   The wrapped output exactly matches `sanitizeGeoSnapshot()` in
--   src/lib/blog/html-builder.ts (P12.R.B7).
--
-- Execution:
--   DO NOT auto-apply. This file is NOT in supabase/migrations/.
--   Must be run via PM-authorized Supabase MCP `execute_sql` (one section at
--   a time, dry-run → sample → apply → verify).
--
-- Reference: docs/superpowers/specs/2026-06-13-phase-12J-wordpress-page-rewriter.md
-- ════════════════════════════════════════════════════════════════════════════

-- ─── Step 1 · Dry-run — how many rows would be affected? ────────────────────
SELECT COUNT(*) AS legacy_rows_count
FROM blog_posts
WHERE geo_html_snapshot ~* '<div[^>]*class="[^"]*seo-instructions[^"]*"[^>]*style="[^"]*position\s*:\s*absolute'
  AND geo_html_snapshot !~* '<div[^>]*\shidden(\s|>|=)';

-- ─── Step 2 · Show 3 sample rows (head only) so we can eyeball the format ───
SELECT
  bp.id,
  c.name AS client_name,
  bp.status,
  bp.created_at::date AS created,
  LEFT(bp.geo_html_snapshot, 250) AS geo_head_250
FROM blog_posts bp
LEFT JOIN clients c ON c.id = bp.client_id
WHERE bp.geo_html_snapshot ~* '<div[^>]*class="[^"]*seo-instructions[^"]*"[^>]*style="[^"]*position\s*:\s*absolute'
  AND bp.geo_html_snapshot !~* '<div[^>]*\shidden(\s|>|=)'
ORDER BY bp.created_at DESC
LIMIT 3;

-- ─── Step 3 · Apply backfill ────────────────────────────────────────────────
-- The wrapper format MUST stay in sync with sanitizeGeoSnapshot() in
-- src/lib/blog/html-builder.ts. Keep these two artifacts byte-identical.
UPDATE blog_posts
SET geo_html_snapshot =
    E'<!-- ME GEO V2 wrapper (legacy V1 auto-sanitize) -->\n'
  ||  '<style>.me-geo-instructions{position:absolute!important;top:-9999px!important;left:-9999px!important;width:1px!important;height:1px!important;overflow:hidden!important;clip:rect(0,0,0,0)!important;white-space:nowrap!important;}</style>' || E'\n'
  ||  '<div hidden aria-hidden="true" class="me-geo-instructions" data-me-geo="v2-wrap">' || E'\n'
  ||  geo_html_snapshot || E'\n'
  ||  '</div>',
  updated_at = NOW()
WHERE geo_html_snapshot ~* '<div[^>]*class="[^"]*seo-instructions[^"]*"[^>]*style="[^"]*position\s*:\s*absolute'
  AND geo_html_snapshot !~* '<div[^>]*\shidden(\s|>|=)';

-- ─── Step 4 · Verify — count rows that now carry the V2 wrapper marker ──────
SELECT COUNT(*) AS post_backfill_v2_wrap_rows
FROM blog_posts
WHERE geo_html_snapshot ~* 'data-me-geo="v2-wrap"';

-- ─── Step 5 · Re-run Step 1 — should now return 0 ───────────────────────────
SELECT COUNT(*) AS remaining_legacy_rows
FROM blog_posts
WHERE geo_html_snapshot ~* '<div[^>]*class="[^"]*seo-instructions[^"]*"[^>]*style="[^"]*position\s*:\s*absolute'
  AND geo_html_snapshot !~* '<div[^>]*\shidden(\s|>|=)';
-- Expected: 0  ✅
