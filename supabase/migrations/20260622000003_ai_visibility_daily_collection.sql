-- ============================================================================
-- Industry AI Visibility Archive — migrate to DAILY collection granularity
-- ============================================================================
-- Background:
--   PR #311 originally designed for weekly collection (week_of as the time
--   axis, UNIQUE on (question_id, platform, week_of)). PM decision 2026-06-04:
--   run daily instead, because AI answers can shift within days and only
--   daily granularity captures the true churn signal (brands appearing /
--   disappearing / climbing within a week).
--
-- Migration strategy:
--   1. Add `collected_date date` column (UTC date of collection)
--   2. Backfill existing rows: collected_date = date(collected_at)
--   3. Drop old UNIQUE constraint on (question_id, platform, week_of)
--   4. Add new UNIQUE on (question_id, platform, collected_date)
--   5. Keep `week_of` column intact — useful for weekly rollup displays;
--      orchestrator continues writing both. Frontend that still groups by
--      week will keep working unchanged.
--
-- Idempotency:
--   ALTER ADD COLUMN IF NOT EXISTS / DROP CONSTRAINT IF EXISTS are used so
--   re-running the migration is safe.
-- ============================================================================

-- 1. Add collected_date column (UTC date), default to today if null
ALTER TABLE industry_ai_visibility_snapshots
  ADD COLUMN IF NOT EXISTS collected_date date;

-- 2. Backfill from collected_at (cast to date in UTC)
UPDATE industry_ai_visibility_snapshots
   SET collected_date = (collected_at AT TIME ZONE 'UTC')::date
 WHERE collected_date IS NULL;

-- 3. Now make it NOT NULL with a sensible default
ALTER TABLE industry_ai_visibility_snapshots
  ALTER COLUMN collected_date SET NOT NULL,
  ALTER COLUMN collected_date SET DEFAULT (now() AT TIME ZONE 'UTC')::date;

-- 4. Drop the weekly UNIQUE constraint (from migration 20260622000002)
ALTER TABLE industry_ai_visibility_snapshots
  DROP CONSTRAINT IF EXISTS iav_snap_unique_question_platform_week;

-- 5. Add new daily UNIQUE constraint
ALTER TABLE industry_ai_visibility_snapshots
  ADD CONSTRAINT iav_snap_unique_question_platform_date
  UNIQUE (question_id, platform, collected_date);

-- 6. Index supporting daily time-series queries (most recent first per question)
CREATE INDEX IF NOT EXISTS iav_snap_q_p_date
  ON industry_ai_visibility_snapshots (question_id, platform, collected_date DESC);

-- 7. Comments documenting the change
COMMENT ON COLUMN industry_ai_visibility_snapshots.collected_date
  IS 'UTC date of collection. Primary time axis (was week_of). Exactly one snapshot per (question, platform, day). week_of column retained for weekly rollup queries.';

COMMENT ON CONSTRAINT iav_snap_unique_question_platform_date
  ON industry_ai_visibility_snapshots
  IS 'Daily uniqueness — re-runs within the same UTC day MUST upsert, not insert duplicates. Replaces the previous weekly constraint.';
