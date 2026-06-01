-- Phase 22.D.1 — AnomalyDetector: anomaly_signals table
--
-- Stores rule-triggered anomaly signals detected by AnomalyDetectorJob.
-- Each row represents one fired rule for one client at one point in time.
-- Second-layer AI (Zhugeliang proactive endpoint) reads NEW signals and
-- generates advisory messages.
--
-- Applied: manually via Supabase dashboard → SQL editor

CREATE TABLE IF NOT EXISTS anomaly_signals (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  flywheel      TEXT NOT NULL CHECK (flywheel IN ('seo', 'geo', 'ads', 'social', 'competitor')),
  metric_key    TEXT NOT NULL,
  rule_id       TEXT NOT NULL,                       -- e.g. 'ads.cpa.surge_30pct_mom'
  severity      TEXT NOT NULL CHECK (severity IN ('high', 'medium', 'low')),
  current_value NUMERIC,
  baseline_value NUMERIC,
  pct_change    NUMERIC,                             -- positive = increase, negative = decrease
  source_ref    JSONB DEFAULT '{}',                  -- extra context (e.g. campaign_id)
  status        TEXT NOT NULL DEFAULT 'new'
                CHECK (status IN ('new', 'acknowledged', 'resolved')),
  detected_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  acknowledged_at TIMESTAMPTZ,
  resolved_at   TIMESTAMPTZ
);

-- Fast lookup: per-client recent signals, ordered by detection time
CREATE INDEX IF NOT EXISTS idx_anomaly_signals_client
  ON anomaly_signals (client_id, detected_at DESC);

-- Filter by status (AI layer polls for status = 'new')
CREATE INDEX IF NOT EXISTS idx_anomaly_signals_status
  ON anomaly_signals (status, detected_at DESC);

-- Composite: rule deduplication within a time window
CREATE INDEX IF NOT EXISTS idx_anomaly_signals_rule
  ON anomaly_signals (client_id, rule_id, detected_at DESC);

COMMENT ON TABLE anomaly_signals IS
  'P22.D.1 — Rule-triggered anomaly signals from AnomalyDetectorJob daily cron.';
