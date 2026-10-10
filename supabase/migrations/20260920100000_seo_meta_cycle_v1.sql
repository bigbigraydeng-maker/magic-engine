-- SEO Meta-Cycle v1 (2026-09-20) — adds the columns the IMPACT-loop redesign
-- needs to Check (T+14 outcome vs baseline) and report it. All
-- ADD COLUMN IF NOT EXISTS — additive only.
--
-- PM 2026-09-20 精简拍板: auto-revert (and the oscillation cap that only
-- existed to bound it) was cut after real usage turned out to be ≤3
-- pages/week for one client — a regressed page becomes one manual kanban
-- item pointing at the PR's own GitHub Revert button instead. revert_count
-- is not added here for that reason.
--
-- See docs/specs/2026-09-20-seo-meta-cycle-v1-spec.md §5 and the
-- 魏征/子牙 review findings recorded in that spec's implementation PR.

ALTER TABLE seo_meta_log
  ADD COLUMN IF NOT EXISTS baseline_ctr NUMERIC,
  ADD COLUMN IF NOT EXISTS baseline_position NUMERIC,
  ADD COLUMN IF NOT EXISTS baseline_impressions INTEGER,
  ADD COLUMN IF NOT EXISTS checked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS outcome TEXT
    CHECK (outcome IN ('improved', 'flat', 'regressed', 'insufficient_data')),
  -- The T+14 Check step's observed (after) reading — kept alongside
  -- baseline_* so the weekly report can show a real before/after CTR
  -- without re-deriving anything (PM item 8: "前后CTR、样本量、判定").
  ADD COLUMN IF NOT EXISTS observed_ctr NUMERIC,
  ADD COLUMN IF NOT EXISTS observed_impressions INTEGER,
  -- The merged PR this row's change actually landed through — the href for
  -- the manual "regressed, go click Revert" kanban item (PM item: no new
  -- revert code, just point at this PR's own GitHub Revert button).
  ADD COLUMN IF NOT EXISTS pr_url TEXT,
  -- Finding #6 (子牙): wp_updated is read by pm-todo/manual-items.ts (meta_stuck
  -- staleness check, assumes a WordPress plugin) and weekly-report/build.ts
  -- (counts "auto changes"). CTS's repo-PR flow always writes wp_updated=false
  -- even after the PR merges, which already silently breaks both readers today
  -- (false "plugin stuck" alerts for a client with no WordPress plugin).
  -- applied_channel distinguishes the two write paths so readers can branch
  -- instead of overloading wp_updated. Default 'wp_plugin' is a starting
  -- point, backfilled below — it is NOT correct for every pre-migration row:
  -- cts-meta-pr.ts (repo-PR flow) has been writing rows since before this
  -- migration too.
  ADD COLUMN IF NOT EXISTS applied_channel TEXT NOT NULL DEFAULT 'wp_plugin'
    CHECK (applied_channel IN ('wp_plugin', 'pr'));

COMMENT ON COLUMN seo_meta_log.baseline_ctr IS 'CTR at the moment this change was applied (0-1 decimal fraction, same scale as GSC) — the T+14 Check step compares against this, not a re-derived AI guess.';
COMMENT ON COLUMN seo_meta_log.baseline_position IS 'GSC average position at the moment this change was applied.';
COMMENT ON COLUMN seo_meta_log.baseline_impressions IS 'GSC impressions in the window ending at optimised_at — the outcome classifier''s sample-size floor is checked against this AND the T+14 impressions, not just recency.';
COMMENT ON COLUMN seo_meta_log.checked_at IS 'When the Check step last classified this row''s outcome. NULL = not checked yet.';
COMMENT ON COLUMN seo_meta_log.outcome IS 'improved/flat/regressed/insufficient_data. insufficient_data means the sample-size floor was not met.';
COMMENT ON COLUMN seo_meta_log.observed_ctr IS 'CTR (0-1 decimal fraction) observed at the T+14 Check, same row/run that set checked_at+outcome.';
COMMENT ON COLUMN seo_meta_log.observed_impressions IS 'Impressions observed at the T+14 Check.';
COMMENT ON COLUMN seo_meta_log.pr_url IS 'The GitHub PR this change was merged through. A regressed row''s manual kanban item links here — click that PR''s own Revert button, no auto-revert code needed.';
COMMENT ON COLUMN seo_meta_log.applied_channel IS 'wp_plugin = client-side WordPress plugin polls wp_updated and applies it (Oztop). pr = Magic Engine opened+merged a PR directly in the client''s repo (CTS). Readers of wp_updated must branch on this column instead of assuming WordPress.';

-- Backfill: every pre-migration row written by cts-meta-pr.ts's repo-PR flow
-- is mislabelled 'wp_plugin' by the column default above. content_type='meta'
-- is a reliable discriminator — the Oztop WP flow only ever inserts
-- content_type IN ('pages','posts'); 'meta' is written exclusively by
-- cts-meta-pr.ts (src/lib/seo-meta/cts-meta-pr.ts:416-427, unchanged by this
-- migration). Without this backfill, pm-todo/manual-items.ts's new
-- applied_channel='pr' exclusion (meant to stop a false "WordPress plugin
-- stopped" alert for CTS) would not apply to any row written before today,
-- and weekly-report/build.ts's applied-changes count would keep undercounting
-- CTS's historical auto-applied changes.
UPDATE seo_meta_log
  SET applied_channel = 'pr'
  WHERE content_type = 'meta' AND applied_channel = 'wp_plugin';
