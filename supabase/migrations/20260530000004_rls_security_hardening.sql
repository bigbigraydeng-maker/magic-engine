-- Security hardening: Enable RLS on 13 tables that were missing it.
-- All use service_role_full — ME only accesses DB via Next.js API Routes
-- (service_role). anon / authenticated roles never need direct DB access.
-- Phase: Security baseline, triggered by Supabase advisor findings.

-- ── 🔴 CRITICAL: Token tables ────────────────────────────────────────────────

-- access_token / refresh_token stored PLAINTEXT — highest risk
ALTER TABLE google_oauth_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_full" ON google_oauth_tokens
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- AES-256-GCM encrypted tokens, but still credential material
ALTER TABLE platform_oauth_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_full" ON platform_oauth_connections
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── 🟠 HIGH: Client L3 AI memory ─────────────────────────────────────────────

ALTER TABLE client_decision_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_full" ON client_decision_history
  FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE client_failed_experiments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_full" ON client_failed_experiments
  FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE client_learned_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_full" ON client_learned_preferences
  FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE client_proven_patterns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_full" ON client_proven_patterns
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── 🟠 HIGH: Client operational logs & messages ───────────────────────────────

ALTER TABLE execution_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_full" ON execution_logs
  FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE luban_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_full" ON luban_messages
  FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE luban_project_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_full" ON luban_project_messages
  FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE project_reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_full" ON project_reviews
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── 🟡 MEDIUM: Archived client data ──────────────────────────────────────────

ALTER TABLE _archived_keywords_2026_05_30 ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_full" ON _archived_keywords_2026_05_30
  FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE _archived_semrush_usage_logs_2026_05_30 ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_full" ON _archived_semrush_usage_logs_2026_05_30
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── 🟢 LOW: Generic reference data ───────────────────────────────────────────

-- No client_id; generic industry benchmarks. Locked down for defense-in-depth.
ALTER TABLE industry_benchmarks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_full" ON industry_benchmarks
  FOR ALL TO service_role USING (true) WITH CHECK (true);
