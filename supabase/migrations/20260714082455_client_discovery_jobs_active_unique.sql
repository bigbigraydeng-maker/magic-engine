-- Closes the TOCTOU cost-DoS residual documented in
-- docs/superpowers/specs/2026-07-08-990-self-serve-onboarding-wizard-v0.1.md §7.1.
-- startAdvancedDiscovery() does a non-atomic SELECT (find in-flight) then
-- INSERT; a burst of near-simultaneous requests for the same client+job_type
-- can each pass the SELECT before either INSERT lands, enqueuing duplicate
-- expensive external-API jobs. This partial unique index makes the second
-- INSERT fail atomically instead. Both call sites already wrap
-- startAdvancedDiscovery in try/catch and degrade gracefully (return null /
-- a clean error), so no application code change is required alongside this.
CREATE UNIQUE INDEX IF NOT EXISTS client_discovery_jobs_active_unique
  ON public.client_discovery_jobs (client_id, job_type)
  WHERE status IN ('pending', 'running');
