-- P21.20: Zhuge workbench feedback instrumentation

CREATE TABLE IF NOT EXISTS zhuge_feedback_events (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id          UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  suggestion_id      TEXT NOT NULL,
  suggestion_key     TEXT NOT NULL,
  suggestion_title   TEXT NOT NULL,
  feedback_state     TEXT NOT NULL CHECK (feedback_state IN ('done', 'dismissed', 'irrelevant')),
  current_area_label TEXT NOT NULL,
  current_href       TEXT,
  client_label       TEXT NOT NULL,
  campaign_label     TEXT,
  task_label         TEXT,
  package_label      TEXT,
  feedback_source    TEXT NOT NULL DEFAULT 'workbench_beta',
  client_recorded_at TIMESTAMPTZ,
  metadata           JSONB,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_zhuge_feedback_events_client
  ON zhuge_feedback_events(client_id);

CREATE INDEX IF NOT EXISTS idx_zhuge_feedback_events_state
  ON zhuge_feedback_events(feedback_state);

CREATE INDEX IF NOT EXISTS idx_zhuge_feedback_events_created_at
  ON zhuge_feedback_events(created_at DESC);

ALTER TABLE zhuge_feedback_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full" ON zhuge_feedback_events FOR ALL USING (true);

COMMENT ON TABLE zhuge_feedback_events IS
  'Beta feedback events for Zhuge workbench suggestions, used to tune future ranking and recommendation quality.';
