-- P21.K.2 — Ad Strategy Engine daily account-health narrative.
--
-- One row per client per day: the engine's verdict on every campaign plus a
-- structured payload the dashboard (P3) and the email digest (P4) both read
-- from a single source (so they never disagree).
--
-- WHY A DEDICATED TABLE (not diagnostic_narratives):
--   diagnostic_narratives.kind is a CHECK-constrained set, every row is
--   NOT NULL REFERENCES diagnostic_runs(id), and it is UNIQUE(run_id, kind,
--   dimension). A daily account narrative has no diagnostic_run to hang off and
--   a different lifecycle from the 6-pillar diagnostic narratives, so forcing
--   it into that table would fight all three constraints (spec §6.3).

CREATE TABLE IF NOT EXISTS ad_health_narratives (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id      UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  insight_date   DATE NOT NULL,

  -- Worst campaign verdict for the day: healthy | watch | alert |
  -- insufficient_history. Drives the email subject line and the dashboard tint.
  overall_verdict TEXT NOT NULL,

  -- One-line, PM-facing summary of the day.
  headline       TEXT,

  -- Full structured result — per-campaign verdicts, metrics, 7-day series and
  -- prescriptions. Shape owned by the engine (buildNarrativePayload); dashboard
  -- and email read it rather than recomputing.
  payload        JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Email delivery state so a resend isn't duplicated: sent | failed | skipped | pending.
  email_status   TEXT NOT NULL DEFAULT 'pending',

  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One narrative per client per day; a re-run updates in place.
CREATE UNIQUE INDEX IF NOT EXISTS ad_health_narratives_client_day_key
  ON ad_health_narratives (client_id, insight_date);

CREATE INDEX IF NOT EXISTS idx_ad_health_narratives_client_date
  ON ad_health_narratives (client_id, insight_date DESC);

ALTER TABLE ad_health_narratives ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "service_role_full" ON ad_health_narratives FOR ALL USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
