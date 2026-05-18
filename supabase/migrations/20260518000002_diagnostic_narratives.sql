-- P8.10.S3.5: diagnostic_narratives — Synthesis-layer outputs (Claude Sonnet)
--
-- Stores Markdown narratives produced by the four synthesis modules:
--   * competitor-analyst  → kinds: 'competitor_market_structure', 'competitor_benchmarking_path'
--   * dimension-narrator  → kind:  'dimension_narrative'           (one row per dimension)
--   * score-explainer     → kind:  'score_explanation'             (one row per dimension + 'overall')
--   * market-context      → kind:  'market_context'                (single row per run, dimension NULL)
--
-- Why a separate table (vs columns on diagnostic_runs / diagnostic_findings):
--   * Synthesis is opt-in and expensive — keeping it out of the hot path makes
--     it safe to skip / re-run / version per module without touching the runs row.
--   * Multiple narratives per run, keyed by (kind, dimension), need their own
--     unique constraint so re-runs upsert cleanly.
--   * model / cost_usd / metadata travel with each narrative, not the run.
--
-- Schema follows the ROADMAP spec: run_id, dimension, narrative_md, generated_at,
-- model, cost_usd — plus `kind` (disambiguates multiple narratives per dimension)
-- and `metadata` JSONB (citations from market-context, key_trends, etc.).
--
-- `dimension` is TEXT (not the diagnostic_dimension enum) so we can store
-- synthesis-only targets like 'overall' and 'market_context' without polluting
-- the enum that drives findings / prescriptions.

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

-- Unique per (run, kind, dimension). NULL dimension is allowed (market_context)
-- but PostgreSQL treats NULLs as distinct in UNIQUE constraints by default —
-- use COALESCE in a unique index to dedupe the NULL case too.
CREATE UNIQUE INDEX IF NOT EXISTS idx_diagnostic_narratives_unique
  ON diagnostic_narratives (run_id, kind, COALESCE(dimension, ''));

CREATE INDEX IF NOT EXISTS idx_diagnostic_narratives_run_id
  ON diagnostic_narratives (run_id);

CREATE INDEX IF NOT EXISTS idx_diagnostic_narratives_client_id
  ON diagnostic_narratives (client_id);

CREATE INDEX IF NOT EXISTS idx_diagnostic_narratives_run_kind
  ON diagnostic_narratives (run_id, kind);

ALTER TABLE diagnostic_narratives ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view diagnostic narratives for their clients"
  ON diagnostic_narratives FOR SELECT
  USING (auth.uid() IN (SELECT user_id FROM client_team WHERE client_id = diagnostic_narratives.client_id));

CREATE POLICY "Users can insert diagnostic narratives for their clients"
  ON diagnostic_narratives FOR INSERT
  WITH CHECK (auth.uid() IN (SELECT user_id FROM client_team WHERE client_id = diagnostic_narratives.client_id));

CREATE POLICY "Users can update diagnostic narratives for their clients"
  ON diagnostic_narratives FOR UPDATE
  USING (auth.uid() IN (SELECT user_id FROM client_team WHERE client_id = diagnostic_narratives.client_id));

COMMENT ON TABLE diagnostic_narratives IS
  'Synthesis-layer Markdown outputs (Claude Sonnet) for a diagnostic run. One row per (kind, dimension). Optional, cheap to drop and regenerate.';
