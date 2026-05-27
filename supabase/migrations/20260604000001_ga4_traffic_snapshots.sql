-- P17.A.2: GA4 Traffic Snapshots — unified data pullback layer
-- Stores periodic Google Analytics 4 snapshots per client.
-- One row per (client_id, period_start, period_end).
-- Complements gsc_performance_snapshots with traffic-side data for:
--   • flywheel attribution (seo/social action → traffic change)
--   • monthly report auto-generation
--   • client portal cross-channel dashboard

CREATE TABLE IF NOT EXISTS ga4_traffic_snapshots (
  id                   UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id            UUID          NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  property_id          TEXT          NOT NULL,
  period_start         DATE          NOT NULL,
  period_end           DATE          NOT NULL,
  -- Site-level aggregates
  total_sessions       INTEGER       NOT NULL DEFAULT 0,
  total_users          INTEGER       NOT NULL DEFAULT 0,
  total_new_users      INTEGER       NOT NULL DEFAULT 0,
  total_pageviews      INTEGER       NOT NULL DEFAULT 0,
  avg_session_duration NUMERIC(10,2) NOT NULL DEFAULT 0,  -- seconds
  bounce_rate          NUMERIC(6,4)  NOT NULL DEFAULT 0,  -- 0–1 ratio
  -- Breakdowns (top 50 each)
  top_pages            JSONB         NOT NULL DEFAULT '[]',
  top_sources          JSONB         NOT NULL DEFAULT '[]',
  synced_at            TIMESTAMPTZ   NOT NULL DEFAULT now(),
  created_at           TIMESTAMPTZ   NOT NULL DEFAULT now(),

  UNIQUE (client_id, period_start, period_end)
);

CREATE INDEX IF NOT EXISTS ga4_snapshots_client_period_idx
  ON ga4_traffic_snapshots (client_id, period_start DESC);

-- RLS: service_role sees everything
ALTER TABLE ga4_traffic_snapshots ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service_role_full" ON ga4_traffic_snapshots FOR ALL USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON TABLE ga4_traffic_snapshots IS
  'P17.A.2: Periodic GA4 traffic snapshots per client. '
  'top_pages:   [{page, pageviews, sessions}]. '
  'top_sources: [{source, medium, sessions, conversions}].';
