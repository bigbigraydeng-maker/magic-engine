-- SEO Meta-Cycle: target-keyword rank verification (2026-10-04).
--
-- Why: the T+14 CTR before/after Check (seo_meta_log.outcome) cannot tell a real
-- effect from noise at a small client's traffic. Placebo test on CTS data with NO
-- title changes (2026-08-18..08-31 vs 2026-09-01..09-14): 35 of 85 eligible pages
-- (41%) moved more than +-1pp CTR, i.e. the old verdict would have called them
-- "improved"/"regressed". Pooling 20 pages still leaves a -36%..+93% relative-CTR
-- noise band. Target-keyword rank is the steadier ruler, so this migration adds the
-- columns that record a rank BASELINE at apply time and up to 3 later rank samples.
--
-- Additive only: nullable columns, no default backfill, no change to the existing
-- `outcome` CHECK (that column stays NULL for new rows during the shadow period),
-- no RLS change (seo_meta_log is already service_role-only, see
-- 20260701000001_seo_meta_log.sql + 20260920000001_fix_seo_meta_log_grants.sql).
--
-- NOTE: `baseline_position` (existing) is the GSC page-average position, NOT the
-- rank of the target keyword. The new columns are named `*_rank_*` on purpose so
-- the two are never confused.
--
-- Review: 子牙 (architecture) + 魏征 (adversarial), 2026-10-04.

ALTER TABLE seo_meta_log
  -- Rank of the client's own result for `keyword` in a live Google SERP fetched
  -- just before the change was applied. NULL whenever status != 'ranked' —
  -- NEVER 0 and NEVER 101: "not in the top N" is a status, not a number.
  ADD COLUMN IF NOT EXISTS baseline_rank_group INTEGER,
  ADD COLUMN IF NOT EXISTS baseline_rank_status TEXT
    CHECK (baseline_rank_status IN ('ranked', 'not_in_top_n', 'other_own_page', 'fetch_failed')),
  -- The SERP depth the baseline was fetched at. Every later sample for this row must
  -- use the same depth (rank values are only comparable at equal depth).
  ADD COLUMN IF NOT EXISTS baseline_serp_depth INTEGER,
  ADD COLUMN IF NOT EXISTS baseline_serp_fetched_at TIMESTAMPTZ,
  -- Later samples, appended one per calendar day (idempotent on re-run):
  -- [{ "day": "2026-10-22", "status": "ranked", "rank_group": 7, "url": "...",
  --    "depth": 30, "fetched_at": "..." }, ...]
  ADD COLUMN IF NOT EXISTS rank_samples JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Result of the rank check. Deliberately NOT "improved/regressed": a rank that did
  -- not move is the expected outcome for a title change and must never read as
  -- "the change did nothing".
  ADD COLUMN IF NOT EXISTS rank_verdict TEXT
    CHECK (rank_verdict IN (
      'not_measured', 'no_detectable_change', 'rank_moved_up', 'rank_moved_down',
      'entered_top_n', 'dropped_out', 'unstable', 'confounded'
    )),
  -- Why: sub-reason for not_measured / unstable / confounded, sample count, median
  -- rank, and the live-title execution check ({ live_title_ok, live_title_checked_at }).
  ADD COLUMN IF NOT EXISTS verdict_detail JSONB;

COMMENT ON COLUMN seo_meta_log.baseline_rank_group IS 'Rank (organic, rank_group) of the client domain for `keyword` in a live SERP just before apply. NULL unless baseline_rank_status = ranked. Never 0, never 101.';
COMMENT ON COLUMN seo_meta_log.baseline_rank_status IS 'ranked | not_in_top_n (absent from the first baseline_serp_depth organic results) | other_own_page (a different page of the same domain ranks, not the target page) | fetch_failed.';
COMMENT ON COLUMN seo_meta_log.baseline_serp_depth IS 'SERP depth used for the baseline; later rank_samples must use the same depth.';
COMMENT ON COLUMN seo_meta_log.baseline_serp_fetched_at IS 'When the baseline SERP was fetched (before the change was applied).';
COMMENT ON COLUMN seo_meta_log.rank_samples IS 'One entry per calendar day, appended by the daily rank sampler. Three valid samples are required before a rank_verdict other than not_measured is written.';
COMMENT ON COLUMN seo_meta_log.rank_verdict IS 'Rank check result. no_detectable_change means "the ruler saw no move", NOT "the title change had no effect" — titles act mainly through CTR, which is too noisy to judge at this traffic.';
COMMENT ON COLUMN seo_meta_log.verdict_detail IS 'Sub-reason + counts + live-title execution check for rank_verdict. Shape is owned by src/lib/seo-meta/cycle/rank-verdict.ts.';
