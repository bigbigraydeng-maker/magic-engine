-- ============================================================================
-- Industry AI Visibility Archive — fix-ups from子牙 PR #311 review
-- ============================================================================
-- H1: Add UNIQUE constraint to snapshot table.
--   Without this, two concurrent collection runs in the same ISO week would
--   double-write snapshots, inflating downstream aggregations and cost
--   accounting. Combined with orchestrator switching from .insert() to
--   .upsert(onConflict='question_id,platform,week_of'), repeat runs now
--   refresh the same row rather than stacking.
-- ============================================================================

ALTER TABLE industry_ai_visibility_snapshots
  ADD CONSTRAINT iav_snap_unique_question_platform_week
  UNIQUE (question_id, platform, week_of);

COMMENT ON CONSTRAINT iav_snap_unique_question_platform_week
  ON industry_ai_visibility_snapshots
  IS 'Exactly one snapshot per (question, platform, ISO week). Re-runs within the same week MUST upsert, not insert duplicates.';
