-- Backfill 13 drifted schema objects that never landed in production.
--
-- Root cause (audited 2026-06-05): a batch of older migrations failed at their
-- CREATE POLICY step because they referenced a multi-tenant model that was never
-- implemented — clients.workspace_id and a client_team table, neither of which
-- exists. Postgres rolled the whole migration back, so the tables/columns were
-- never created even though the .sql files are in the repo.
--
-- ME's real access model is service-role + Bearer-token API (supabaseAdmin),
-- never end-user RLS. So every policy here is the same: service_role full access.
-- The original buggy policies (workspace_id / client_team) are intentionally NOT
-- recreated.
--
-- Everything is IF NOT EXISTS / idempotent — safe to re-run, and safe against the
-- objects from the partial-apply files that already landed (e.g. local_serp_rankings,
-- blog_posts.mode) which this migration skips.
--
-- Drift inventory (file of origin → object backfilled here):
--   20260601000002_keyword_snapshots_local_pack_rank → keyword_snapshots.local_pack_rank
--   20260502000010_client_contact_info               → clients.contact_name/email/phone
--   20260507000002_fix_gin_index_client_site_pages   → client_site_pages.search_vector (+GIN/trigger)
--   20260601000002_website_lead_events               → website_lead_events
--   20260514000004_case_library                      → prescription_cases / prescription_outcomes / local_data_cache
--   20260501000008_monthly_report_aggregation        → datasource_monthly_reports / _snapshots / _sections
--   20260518000002_diagnostic_narratives             → diagnostic_narratives
--   20260505000001_blog_posts_dual_signal_fields     → blog_posts.geo_directive_version_id
--   20260501000006_local_serp_rankings               → local_ranking_history

-- ════════════════════════════════════════════════════════════════════════════
-- A-class columns (clean ADD COLUMN IF NOT EXISTS)
-- ════════════════════════════════════════════════════════════════════════════

-- keyword_snapshots.local_pack_rank — Google Local Pack rank (1-3, NULL if absent)
ALTER TABLE keyword_snapshots
  ADD COLUMN IF NOT EXISTS local_pack_rank INTEGER;
DO $$ BEGIN
  ALTER TABLE keyword_snapshots
    ADD CONSTRAINT keyword_snapshots_local_pack_rank_check
      CHECK (local_pack_rank IS NULL OR (local_pack_rank >= 1 AND local_pack_rank <= 3));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS idx_keyword_snapshots_local_pack
  ON keyword_snapshots(client_id, snapshot_date DESC)
  WHERE local_pack_rank IS NOT NULL;

-- clients contact info (industry already present from another migration → skipped)
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS contact_name   text,
  ADD COLUMN IF NOT EXISTS contact_email  text,
  ADD COLUMN IF NOT EXISTS contact_phone  text;

-- blog_posts.geo_directive_version_id (rest of dual-signal columns already present)
ALTER TABLE blog_posts
  ADD COLUMN IF NOT EXISTS geo_directive_version_id UUID
    REFERENCES geo_directives(id) ON DELETE SET NULL;

-- client_site_pages full-text search vector (+ GIN + sync trigger)
ALTER TABLE client_site_pages
  ADD COLUMN IF NOT EXISTS search_vector tsvector;
CREATE INDEX IF NOT EXISTS idx_client_site_pages_search_vector
  ON client_site_pages USING GIN(search_vector);
CREATE OR REPLACE FUNCTION update_client_site_pages_search_vector()
RETURNS TRIGGER AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('english', COALESCE(NEW.title, '')), 'A') ||
    setweight(to_tsvector('english', COALESCE(NEW.url, '')), 'B') ||
    setweight(to_tsvector('english', COALESCE(NEW.primary_keyword, '')), 'B') ||
    setweight(to_tsvector('english', COALESCE(NEW.markdown_content, '')), 'C');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trigger_client_site_pages_search_vector ON client_site_pages;
CREATE TRIGGER trigger_client_site_pages_search_vector
  BEFORE INSERT OR UPDATE ON client_site_pages
  FOR EACH ROW EXECUTE FUNCTION update_client_site_pages_search_vector();

-- ════════════════════════════════════════════════════════════════════════════
-- A-class tables (clean CREATE TABLE, service_role RLS)
-- ════════════════════════════════════════════════════════════════════════════

-- website_lead_events — landing-page CTA click tracking
CREATE TABLE IF NOT EXISTS website_lead_events (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  page_path    TEXT NOT NULL,
  cta_key      TEXT NOT NULL,
  destination  TEXT NOT NULL,
  target_href  TEXT NOT NULL,
  source       TEXT NOT NULL DEFAULT 'training',
  referrer     TEXT,
  metadata     JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_website_lead_events_page_path ON website_lead_events(page_path);
CREATE INDEX IF NOT EXISTS idx_website_lead_events_cta_key   ON website_lead_events(cta_key);
CREATE INDEX IF NOT EXISTS idx_website_lead_events_created_at ON website_lead_events(created_at DESC);
ALTER TABLE website_lead_events ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service_role_full" ON website_lead_events FOR ALL USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- prescription_cases — 「张骞→华佗」service snapshot (case library)
CREATE TABLE IF NOT EXISTS prescription_cases (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id            UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  discovery_id         UUID NOT NULL REFERENCES client_discovery(id) ON DELETE CASCADE,
  prescription_id      UUID NOT NULL REFERENCES prescriptions(id) ON DELETE CASCADE,
  industry_category    TEXT,
  crisis_type          TEXT,
  monthly_budget_aud   INTEGER,
  market               TEXT CHECK (market IN ('AU', 'NZ')),
  business_size        TEXT,
  prescription_summary TEXT,
  self_grade_overall   NUMERIC,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_prescription_cases_lookup
  ON prescription_cases(industry_category, crisis_type, monthly_budget_aud);
ALTER TABLE prescription_cases ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service_role_full" ON prescription_cases FOR ALL USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- prescription_outcomes — 30/60/90-day KPI feedback loop
CREATE TABLE IF NOT EXISTS prescription_outcomes (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prescription_id      UUID NOT NULL REFERENCES prescriptions(id) ON DELETE CASCADE,
  case_id              UUID NOT NULL REFERENCES prescription_cases(id) ON DELETE CASCADE,
  client_id            UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  kpi_metric           TEXT NOT NULL,
  target_value         NUMERIC,
  actual_value         NUMERIC,
  unit                 TEXT,
  dimension            TEXT,
  measured_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  days_since_approval  INTEGER,
  data_source          TEXT CHECK (data_source IN ('semrush_auto', 'manual_fde')),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_prescription_outcomes_prescription ON prescription_outcomes(prescription_id);
CREATE INDEX IF NOT EXISTS idx_prescription_outcomes_case ON prescription_outcomes(case_id);
ALTER TABLE prescription_outcomes ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service_role_full" ON prescription_outcomes FOR ALL USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- local_data_cache — local connector result cache
CREATE TABLE IF NOT EXISTS local_data_cache (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cache_key   TEXT NOT NULL UNIQUE,
  connector   TEXT NOT NULL,
  market      TEXT,
  payload     JSONB NOT NULL,
  fetched_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_local_data_cache_expires_at ON local_data_cache(expires_at);
ALTER TABLE local_data_cache ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service_role_full" ON local_data_cache FOR ALL USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- B-class tables (original RLS referenced workspace_id / client_team → replaced
-- with service_role_full)
-- ════════════════════════════════════════════════════════════════════════════

-- datasource_monthly_reports (+ snapshots + sections) — monthly report aggregation
CREATE TABLE IF NOT EXISTS datasource_monthly_reports (
  id BIGSERIAL PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  month TEXT NOT NULL,
  ai_avg_ranking DECIMAL(5, 2),
  ai_ranking_change DECIMAL(5, 2),
  ai_tracked_questions INTEGER DEFAULT 0,
  backlinks_total INTEGER DEFAULT 0,
  backlinks_new_this_month INTEGER DEFAULT 0,
  backlinks_lost_this_month INTEGER DEFAULT 0,
  backlinks_quality_score DECIMAL(5, 2),
  serp_avg_position DECIMAL(5, 2),
  serp_position_change DECIMAL(5, 2),
  serp_tracked_keywords INTEGER DEFAULT 0,
  serp_top10_keywords INTEGER DEFAULT 0,
  serp_top50_keywords INTEGER DEFAULT 0,
  serp_new_rankings INTEGER DEFAULT 0,
  serp_lost_rankings INTEGER DEFAULT 0,
  local_avg_position DECIMAL(5, 2),
  local_tracked_keywords INTEGER DEFAULT 0,
  local_top10_keywords INTEGER DEFAULT 0,
  local_cities_covered INTEGER DEFAULT 0,
  market_opportunity_score DECIMAL(5, 2),
  market_top_opportunities INTEGER DEFAULT 0,
  market_underperformers INTEGER DEFAULT 0,
  billing_total_cost DECIMAL(12, 4) DEFAULT 0,
  billing_total_api_calls BIGINT DEFAULT 0,
  last_synced_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(client_id, month)
);
CREATE TABLE IF NOT EXISTS datasource_monthly_report_snapshots (
  id BIGSERIAL PRIMARY KEY,
  report_id BIGINT NOT NULL REFERENCES datasource_monthly_reports(id) ON DELETE CASCADE,
  snapshot_date DATE NOT NULL,
  ai_avg_ranking DECIMAL(5, 2),
  serp_avg_position DECIMAL(5, 2),
  serp_top10_keywords INTEGER,
  backlinks_total INTEGER,
  market_opportunity_score DECIMAL(5, 2),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(report_id, snapshot_date)
);
CREATE TABLE IF NOT EXISTS datasource_report_sections (
  id BIGSERIAL PRIMARY KEY,
  report_id BIGINT NOT NULL REFERENCES datasource_monthly_reports(id) ON DELETE CASCADE,
  section_type TEXT NOT NULL,
  section_data JSONB NOT NULL,
  last_updated TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(report_id, section_type)
);
CREATE INDEX IF NOT EXISTS idx_monthly_reports_client_month ON datasource_monthly_reports(client_id, month DESC);
CREATE INDEX IF NOT EXISTS idx_monthly_reports_updated ON datasource_monthly_reports(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_monthly_snapshots_report ON datasource_monthly_report_snapshots(report_id);
CREATE INDEX IF NOT EXISTS idx_report_sections_report ON datasource_report_sections(report_id);
CREATE INDEX IF NOT EXISTS idx_report_sections_type ON datasource_report_sections(section_type);
ALTER TABLE datasource_monthly_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE datasource_monthly_report_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE datasource_report_sections ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service_role_full" ON datasource_monthly_reports FOR ALL USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "service_role_full" ON datasource_monthly_report_snapshots FOR ALL USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "service_role_full" ON datasource_report_sections FOR ALL USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- diagnostic_narratives — Synthesis-layer Sonnet outputs (original RLS used client_team)
CREATE TABLE IF NOT EXISTS diagnostic_narratives (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id        UUID NOT NULL REFERENCES diagnostic_runs(id) ON DELETE CASCADE,
  client_id     UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL,
  dimension     TEXT,
  narrative_md  TEXT NOT NULL,
  metadata      JSONB,
  model         TEXT NOT NULL,
  cost_usd      NUMERIC(10, 6) NOT NULL DEFAULT 0,
  generated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT diagnostic_narratives_kind_check CHECK (kind IN (
    'competitor_market_structure',
    'competitor_benchmarking_path',
    'dimension_narrative',
    'score_explanation',
    'market_context'
  ))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_diagnostic_narratives_unique
  ON diagnostic_narratives (run_id, kind, COALESCE(dimension, ''));
CREATE INDEX IF NOT EXISTS idx_diagnostic_narratives_run_id ON diagnostic_narratives (run_id);
CREATE INDEX IF NOT EXISTS idx_diagnostic_narratives_client_id ON diagnostic_narratives (client_id);
CREATE INDEX IF NOT EXISTS idx_diagnostic_narratives_run_kind ON diagnostic_narratives (run_id, kind);
ALTER TABLE diagnostic_narratives ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service_role_full" ON diagnostic_narratives FOR ALL USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- local_ranking_history — only this table from 20260501000006 failed to land
-- (local_serp_rankings / local_cities already present). update_updated_at_column()
-- trigger func is reused if it exists; guard the trigger create.
CREATE TABLE IF NOT EXISTS local_ranking_history (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  keyword text not null,
  location_code int not null,
  city_name text not null,
  position_start int,
  position_current int,
  position_change int,
  date_start date,
  date_end date,
  is_new boolean default false,
  is_lost boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint local_history_unique unique(client_id, keyword, location_code, date_end)
);
CREATE INDEX IF NOT EXISTS idx_local_history_client_city ON local_ranking_history(client_id, location_code);
CREATE INDEX IF NOT EXISTS idx_local_history_date_end ON local_ranking_history(date_end);
ALTER TABLE local_ranking_history ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service_role_full" ON local_ranking_history FOR ALL USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
