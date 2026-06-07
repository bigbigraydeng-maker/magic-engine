-- Cron health monitoring: unified run log for all cron jobs
-- Each cron writes a row on start (status=running) and updates on finish.
-- TTL trigger auto-deletes rows older than 30 days to prevent unbounded growth.

CREATE TABLE IF NOT EXISTS public.cron_run_logs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_name        TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'running'
                    CHECK (status IN ('running', 'completed', 'failed')),
  started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at     TIMESTAMPTZ,
  duration_ms     INTEGER,
  processed       INTEGER DEFAULT 0,
  completed_count INTEGER DEFAULT 0,
  failed_count    INTEGER DEFAULT 0,
  summary         JSONB,
  error_message   TEXT
);

CREATE INDEX IF NOT EXISTS cron_run_logs_job_name_idx
  ON public.cron_run_logs(job_name, started_at DESC);

CREATE INDEX IF NOT EXISTS cron_run_logs_started_at_idx
  ON public.cron_run_logs(started_at DESC);

ALTER TABLE public.cron_run_logs ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service_role_full" ON public.cron_run_logs FOR ALL USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE OR REPLACE FUNCTION public.cron_run_logs_cleanup()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM public.cron_run_logs
  WHERE started_at < NOW() - INTERVAL '30 days';
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cron_run_logs_ttl ON public.cron_run_logs;
CREATE TRIGGER cron_run_logs_ttl
  AFTER INSERT ON public.cron_run_logs
  FOR EACH STATEMENT EXECUTE FUNCTION public.cron_run_logs_cleanup();
