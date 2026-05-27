-- P17.A.1: GSC Performance Snapshots — unified data pullback layer
-- Stores periodic Google Search Console snapshots per client.
-- One row per (client_id, period_start, period_end).
-- Replaces ad-hoc GSC reads with queryable historical data for:
--   • flywheel attribution (baseline vs after)
--   • monthly report auto-generation
--   • client portal cross-channel dashboard

CREATE TABLE IF NOT EXISTS gsc_performance_snapshots (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id          UUID        NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  site_url           TEXT        NOT NULL,
  period_start       DATE        NOT NULL,
  period_end         DATE        NOT NULL,
  -- Site-level aggregates
  total_clicks       INTEGER     NOT NULL DEFAULT 0,
  total_impressions  INTEGER     NOT NULL DEFAULT 0,
  avg_ctr            NUMERIC(6,4) NOT NULL DEFAULT 0,
  avg_position       NUMERIC(6,2) NOT NULL DEFAULT 0,
  -- Query / page breakdown (top 50 each)
  top_queries        JSONB       NOT NULL DEFAULT '[]',
  top_pages          JSONB       NOT NULL DEFAULT '[]',
  synced_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (client_id, period_start, period_end)
);

CREATE INDEX IF NOT EXISTS gsc_snapshots_client_period_idx
  ON gsc_performance_snapshots (client_id, period_start DESC);

-- RLS: service_role sees everything
ALTER TABLE gsc_performance_snapshots ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service_role_full" ON gsc_performance_snapshots FOR ALL USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON TABLE gsc_performance_snapshots IS
  'P17.A.1: Periodic GSC Search Analytics snapshots per client. '
  'top_queries: [{query, clicks, impressions, ctr, position}]. '
  'top_pages:   [{page, clicks, impressions, ctr, position}].';
