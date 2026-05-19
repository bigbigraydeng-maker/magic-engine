-- P8.10.S0.22: Client Connectors + advanced discovery job type
-- Tracks which data connectors are authorized for each client.
-- When meta-ads or gbp is connected, advanced discovery auto-triggers.

-- ── client_connectors ────────────────────────────────────────────────────────
-- One row per (client, anchor). UPSERT on (client_id, anchor).

CREATE TABLE IF NOT EXISTS client_connectors (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id    UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  anchor       TEXT NOT NULL,     -- 'meta-ads' | 'gbp' | 'gsc' | 'ga4' | etc.
  status       TEXT NOT NULL DEFAULT 'not_connected',  -- 'connected' | 'not_connected'
  config       JSONB,             -- { page_url?, access_token? } — never store raw secrets here
  connected_at TIMESTAMPTZ,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (client_id, anchor)
);

CREATE INDEX IF NOT EXISTS idx_client_connectors_client_id ON client_connectors(client_id);

ALTER TABLE client_connectors ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service_role_full" ON client_connectors FOR ALL USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON TABLE client_connectors IS
  'P8.10.S0.22: Per-client connector authorization. One row per (client, anchor). '
  'Connecting meta-ads or gbp auto-triggers advanced discovery.';

-- ── client_discovery_jobs: add job_type ──────────────────────────────────────
-- Distinguishes basic (first-time) from advanced (post-connector) runs.

ALTER TABLE client_discovery_jobs
  ADD COLUMN IF NOT EXISTS job_type TEXT NOT NULL DEFAULT 'basic';

COMMENT ON COLUMN client_discovery_jobs.job_type IS
  '''basic'' = first-time discovery; ''advanced'' = post-connector enrichment run.';
