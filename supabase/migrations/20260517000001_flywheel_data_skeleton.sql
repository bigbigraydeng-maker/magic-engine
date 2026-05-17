-- P12.A.1: Flywheel data skeleton
-- Three new tables: flywheel_actions / flywheel_metrics / flywheel_outcomes
-- Plus: ALTER execution_items ADD execution_target JSONB
-- Reference: ROADMAP.md P12.A.1, CLAUDE.md § Phase 12

-- ── Enums ─────────────────────────────────────────────────────────────────────

CREATE TYPE flywheel_name AS ENUM ('seo', 'geo', 'ads', 'social');

CREATE TYPE flywheel_execution_mode AS ENUM ('in_house', 'third_party', 'external_manual');

CREATE TYPE flywheel_outcome_verdict AS ENUM ('confirmed', 'inconclusive', 'reversed');

-- ── §1: flywheel_actions ──────────────────────────────────────────────────────
-- One row per executed action (e.g. "deploy GEO directive for CTS").
-- Linked to the execution_items row that triggered it.

CREATE TABLE IF NOT EXISTS flywheel_actions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id        UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  execution_item_id UUID REFERENCES execution_items(id) ON DELETE SET NULL,
  flywheel         flywheel_name NOT NULL,
  action_type      TEXT NOT NULL,          -- e.g. 'geo.deploy_directive'
  execution_mode   flywheel_execution_mode NOT NULL DEFAULT 'in_house',
  vendor           TEXT,                   -- e.g. 'markisfact', 'publer', null for in_house
  payload          JSONB,                  -- action-specific data
  expected_metric  TEXT,                   -- metric_key expected to improve (FK-free, validated in app)
  expected_delta   NUMERIC,               -- positive = improvement expected
  executed_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_flywheel_actions_client       ON flywheel_actions(client_id);
CREATE INDEX idx_flywheel_actions_flywheel     ON flywheel_actions(flywheel);
CREATE INDEX idx_flywheel_actions_executed_at  ON flywheel_actions(executed_at DESC);
CREATE INDEX idx_flywheel_actions_metric       ON flywheel_actions(expected_metric);

ALTER TABLE flywheel_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full" ON flywheel_actions FOR ALL USING (true);

COMMENT ON TABLE flywheel_actions IS
  'One row per flywheel action executed. Links execution_items → flywheel_metrics via expected_metric.';

-- ── §2: flywheel_metrics ──────────────────────────────────────────────────────
-- Time-series snapshots of measurable signals per client.
-- Written by AI Tracker runs, SEMrush snapshots, etc.

CREATE TABLE IF NOT EXISTS flywheel_metrics (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id    UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  flywheel     flywheel_name NOT NULL,
  metric_key   TEXT NOT NULL,     -- e.g. 'geo.query.mention_rate'
  metric_value NUMERIC NOT NULL,
  source       TEXT NOT NULL,     -- e.g. 'ai_tracker', 'semrush', 'manual'
  source_ref   JSONB,             -- {run_id: '...', query: '...'} etc.
  measured_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_flywheel_metrics_client        ON flywheel_metrics(client_id);
CREATE INDEX idx_flywheel_metrics_lookup        ON flywheel_metrics(client_id, metric_key, measured_at DESC);
CREATE INDEX idx_flywheel_metrics_measured_at   ON flywheel_metrics(measured_at DESC);

ALTER TABLE flywheel_metrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full" ON flywheel_metrics FOR ALL USING (true);

COMMENT ON TABLE flywheel_metrics IS
  'Time-series metric snapshots per client. Written by AI Tracker, SEMrush cron, etc.';

-- ── §3: flywheel_outcomes ─────────────────────────────────────────────────────
-- Attribution results: did a given action move the expected metric?
-- Computed by the attribution job (P12.A.8).

CREATE TABLE IF NOT EXISTS flywheel_outcomes (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action_id      UUID NOT NULL REFERENCES flywheel_actions(id) ON DELETE CASCADE,
  client_id      UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  metric_key     TEXT NOT NULL,
  baseline       NUMERIC,          -- metric value before action
  after_value    NUMERIC,          -- metric value after action
  delta          NUMERIC,          -- after_value - baseline
  delta_pct      NUMERIC,          -- percentage change
  confidence     NUMERIC CHECK (confidence >= 0 AND confidence <= 1),
  verdict        flywheel_outcome_verdict NOT NULL DEFAULT 'inconclusive',
  window_days    SMALLINT NOT NULL DEFAULT 30,
  computed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_flywheel_outcomes_action     ON flywheel_outcomes(action_id);
CREATE INDEX idx_flywheel_outcomes_client     ON flywheel_outcomes(client_id);
CREATE INDEX idx_flywheel_outcomes_computed   ON flywheel_outcomes(computed_at DESC);

ALTER TABLE flywheel_outcomes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full" ON flywheel_outcomes FOR ALL USING (true);

COMMENT ON TABLE flywheel_outcomes IS
  'Attribution: did a flywheel_action move the expected metric? Written by the attribution job.';

-- ── §4: ALTER execution_items — add execution_target ─────────────────────────
-- execution_target encodes HOW an item should be executed:
-- { flywheel, mode, vendor?, action_type? }
-- Populated by the prescription generator (P12.A.11);
-- backfilled for existing rows via the mapping below.

ALTER TABLE execution_items
  ADD COLUMN IF NOT EXISTS execution_target JSONB;

COMMENT ON COLUMN execution_items.execution_target IS
  'Execution routing: {flywheel, mode, vendor?, action_type?}. Null = not yet mapped.';

-- ── §5: Backfill existing execution_items ────────────────────────────────────
-- Map dimension → flywheel + mode for all existing rows.
-- reputation and competitor are external_manual (FDE-only, no flywheel ingest).

UPDATE execution_items
SET execution_target = CASE dimension
  WHEN 'seo'           THEN '{"flywheel":"seo",    "mode":"in_house"}'::JSONB
  WHEN 'ai_visibility' THEN '{"flywheel":"geo",    "mode":"in_house"}'::JSONB
  WHEN 'ads'           THEN '{"flywheel":"ads",    "mode":"third_party"}'::JSONB
  WHEN 'social'        THEN '{"flywheel":"social", "mode":"third_party"}'::JSONB
  WHEN 'reputation'    THEN '{"flywheel":"geo",    "mode":"external_manual", "vendor":"fde"}'::JSONB
  WHEN 'competitor'    THEN '{"flywheel":"seo",    "mode":"external_manual", "vendor":"fde"}'::JSONB
  ELSE NULL
END
WHERE execution_target IS NULL;
