-- FDE Work Logs: daily session summaries written by FDE/PM per client
CREATE TABLE IF NOT EXISTS fde_work_logs (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   uuid        NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  log_date    date        NOT NULL DEFAULT current_date,
  summary     text        NOT NULL CHECK (char_length(summary) > 0),
  author_email text       NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS fde_work_logs_client_date
  ON fde_work_logs(client_id, log_date DESC);

ALTER TABLE fde_work_logs ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "service_role_full" ON fde_work_logs FOR ALL USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
