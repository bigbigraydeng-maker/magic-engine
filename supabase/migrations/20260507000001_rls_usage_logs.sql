-- ============================================
-- TD.4: Add RLS policies to tables flagged by Supabase advisor
-- 2026-05-07
-- ============================================
-- Problem: Three tables either lacked RLS in migrations or had RLS enabled
-- without any policy. Without an explicit policy, anon / authenticated roles
-- have zero access (which happens to be safe today since all writes go via
-- service_role), but the Supabase database linter (advisor) flags this as
-- "RLS Enabled No Policy" and the configuration is fragile — adding a future
-- anon-facing route would silently expose the data.
--
-- Fix: enable RLS where missing and add an explicit service_role-only policy
-- on each table. service_role bypasses RLS by default, so this is a no-op
-- functionally but documents the intent ("server-only writes / reads").
--
-- Tables covered:
--   1. datasource_usage_logs   — billing-sensitive per-client API cost
--   2. semrush_usage_logs      — billing-sensitive per-client unit usage
--   3. site_audit_jobs         — per-client crawl job state
--
-- Reference: CLAUDE.md §三 / TD.4, Supabase advisor lint 0008_rls_enabled_no_policy
-- ============================================

-- 1. datasource_usage_logs (RLS may already be on in remote DB)
ALTER TABLE public.datasource_usage_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "datasource_usage_logs_service_role_full" ON public.datasource_usage_logs;
CREATE POLICY "datasource_usage_logs_service_role_full"
  ON public.datasource_usage_logs
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- 2. semrush_usage_logs
ALTER TABLE public.semrush_usage_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "semrush_usage_logs_service_role_full" ON public.semrush_usage_logs;
CREATE POLICY "semrush_usage_logs_service_role_full"
  ON public.semrush_usage_logs
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- 3. site_audit_jobs
ALTER TABLE public.site_audit_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "site_audit_jobs_service_role_full" ON public.site_audit_jobs;
CREATE POLICY "site_audit_jobs_service_role_full"
  ON public.site_audit_jobs
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
