-- MF6 (魏征 B2 review): partial unique index preventing two pending_pr rows
-- for the same (client_id, directive_id, target_path).
--
-- Without this, two concurrent publish requests can both findOpenDeployment()
-- → null, both record a fresh row, both end up with status='pending_pr',
-- and findOpenDeployment for the next publish picks only one of them by
-- created_at DESC — the loser's PR stays open forever, untracked.
--
-- The application catches Postgres 23505 (unique_violation) on this index
-- and returns 422 CONCURRENT_PUBLISH_IN_PROGRESS so the FDE can retry once
-- the first publish finishes.

CREATE UNIQUE INDEX IF NOT EXISTS idx_geo_deployments_unique_pending
  ON geo_deployments (client_id, directive_id, target_path)
  WHERE status = 'pending_pr';

COMMENT ON INDEX idx_geo_deployments_unique_pending IS
  'MF6 race guard: at most one pending_pr row per (client, directive, target). '
  'Concurrent publish attempts hit 23505 and are turned into 422 by the route.';
