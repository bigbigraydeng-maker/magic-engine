-- P22.D.1: anomaly_signals table
-- Stores standardised anomaly signals output by AnomalyDetectorJob (cron, no AI).
-- Consumed downstream by POST /api/ai/zhugeliang/proactive (P22.D.2).
-- Reference: ROADMAP.md § Phase 22.D

-- ── Enum: severity ────────────────────────────────────────────────────────────

CREATE TYPE anomaly_severity AS ENUM ('high', 'medium', 'low');

-- ── Table: anomaly_signals ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS anomaly_signals (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,

  -- Which flywheel + metric triggered this anomaly
  flywheel        flywheel_name NOT NULL,
  metric_key      TEXT NOT NULL,

  -- Rule that fired (matches AnomalyRule.id in AnomalyDetectorJob)
  rule_id         TEXT NOT NULL,

  severity        anomaly_severity NOT NULL,

  -- Snapshot values at detection time
  current_value   NUMERIC NOT NULL,
  reference_value NUMERIC NOT NULL,     -- baseline / comparison value
  delta_pct       NUMERIC NOT NULL,     -- signed % change (negative = drop)

  -- Human-readable description for display + AI context
  description     TEXT NOT NULL,

  -- Downstream processing state
  -- null = fresh, 'processed' = zhugeliang has seen it, 'dismissed' = no-op
  status          TEXT NOT NULL DEFAULT 'fresh'
                  CHECK (status IN ('fresh', 'processed', 'dismissed')),

  -- Link back to the flywheel_action that was auto-created (P22.D.2)
  flywheel_action_id UUID REFERENCES flywheel_actions(id) ON DELETE SET NULL,

  detected_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_anomaly_signals_client
  ON anomaly_signals(client_id);

CREATE INDEX idx_anomaly_signals_lookup
  ON anomaly_signals(client_id, flywheel, status, detected_at DESC);

CREATE INDEX idx_anomaly_signals_fresh
  ON anomaly_signals(status, detected_at DESC)
  WHERE status = 'fresh';

ALTER TABLE anomaly_signals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full" ON anomaly_signals FOR ALL USING (true);

COMMENT ON TABLE anomaly_signals IS
  'Standardised anomaly signals from AnomalyDetectorJob (P22.D). '
  'status=fresh → awaiting zhugeliang/proactive; processed → action created; dismissed → no-op.';
