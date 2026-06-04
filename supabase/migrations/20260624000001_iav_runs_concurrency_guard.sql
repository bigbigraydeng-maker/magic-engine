-- ============================================================================
-- 魏征 Hotfix-2 — Industry AI Visibility concurrency + stale-run protection
-- ----------------------------------------------------------------------------
-- Problem: ai-collect/route.ts has an application-level guard (refuse if a
-- run started in the last 5 min is still 'running'), but two requests racing
-- past that check would both create rows. DB-level partial unique index makes
-- "two concurrent running rows" structurally impossible regardless of caller.
--
-- Stale-run sweeper: a separate cron job will reset rows stuck > 10 min in
-- 'running' to 'failed' — protects against serverless workers being killed
-- mid-execution leaving rows pinned forever.
-- ============================================================================

-- Allow at most ONE row in 'running' status at any time across the whole table.
-- This is a partial unique index — completed / failed / partial rows are not
-- constrained, so historical runs remain intact.
CREATE UNIQUE INDEX iav_runs_single_in_flight
  ON industry_ai_visibility_runs ((1))
  WHERE status = 'running';

COMMENT ON INDEX iav_runs_single_in_flight IS
  '魏征 Hotfix-2: structurally enforces "only one running row at a time" across all callers (cron + admin manual + future API). Application-level guard in ai-collect/route.ts is the friendly path; this index is the safety net.';
