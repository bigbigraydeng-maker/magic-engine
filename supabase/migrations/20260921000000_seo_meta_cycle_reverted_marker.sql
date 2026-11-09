-- SEO Meta-Cycle v1 — incident follow-up (2026-09-20, CTS W38 first real run).
--
-- Two changes auto-merged with factually wrong content (chinatravel #199/#200)
-- were reverted via GitHub's own Revert button (chinatravel #201/#202,
-- already merged). PM: mark the original two seo_meta_log rows as reverted
-- — do NOT delete them (they're the audit trail of what happened) — and make
-- sure they never再 participate in the T+14 Check or the 30-day cooldown
-- (a reverted assignment was never a real, standing change; leaving it
-- counted would either falsely "check" a change that no longer exists, or
-- block the same slug from being retried for 30 days over a mistake that's
-- already fixed).
--
-- ADD COLUMN IF NOT EXISTS — additive only. The scoped UPDATE below is
-- idempotent (repeat runs are no-ops once applied) and matches by exact
-- client_id + page_slug + the known W38 application week, per PM's incident
-- report — not a broad pattern match.

ALTER TABLE seo_meta_log
  ADD COLUMN IF NOT EXISTS reverted_at TIMESTAMPTZ;

COMMENT ON COLUMN seo_meta_log.reverted_at IS 'Set when this row''s change was reverted (GitHub Revert PR merged, or PM decision). Excluded from the T+14 Check (runStep1CheckDue) and the cooldown/reuse windows (runStep2CandidatesReady, gate.ts checkNoRecentReuse) — a reverted assignment was never a real, standing change.';

-- CTS = c0000000-0000-0000-0000-000000000000 (docs/STATE.md).
UPDATE seo_meta_log
  SET reverted_at = now()
  WHERE client_id = 'c0000000-0000-0000-0000-000000000000'
    AND page_slug IN ('liziba-station-chongqing-guide', 'china-visa-free-nz-2026')
    AND optimised_at >= '2026-09-15T00:00:00Z'
    AND optimised_at <  '2026-09-22T00:00:00Z'
    AND reverted_at IS NULL;
