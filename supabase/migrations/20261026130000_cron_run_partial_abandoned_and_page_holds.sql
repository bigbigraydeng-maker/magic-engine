-- Reliability: cron_run_logs may be partial or abandoned, and a broken Meta
-- page token can be held without an OAuth row.
--
-- DO NOT apply this file to production from the PR that adds it. Ship the
-- file only. Status writes fall back to `failed` until the check constraint
-- is updated; the hold table is skipped when it is not there yet
-- (isKernelNotProvisioned).

-- Inline CHECK from 20260606000011 is named cron_run_logs_status_check.
ALTER TABLE public.cron_run_logs DROP CONSTRAINT IF EXISTS cron_run_logs_status_check;
ALTER TABLE public.cron_run_logs
  ADD CONSTRAINT cron_run_logs_status_check
  CHECK (status IN ('running', 'completed', 'partial', 'failed', 'abandoned'));

COMMENT ON CONSTRAINT cron_run_logs_status_check ON public.cron_run_logs IS
  'partial = some items failed; abandoned = still running past 2x expected duration';

-- No OAuth row to mark status=error (shared env token / unverified binding).
-- The hourly syncs skip a page while a row exists here. Reconnect deletes it.
CREATE TABLE IF NOT EXISTS public.meta_page_sync_holds (
  client_id     UUID        NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  page_id       TEXT        NOT NULL,
  reason        TEXT        NOT NULL
                CHECK (reason IN ('graph_190', 'missing_page_role', 'unverified_shared_token')),
  error_message TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (client_id, page_id)
);

ALTER TABLE public.meta_page_sync_holds ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_full" ON public.meta_page_sync_holds;
CREATE POLICY "service_role_full" ON public.meta_page_sync_holds
  FOR ALL TO service_role USING (true) WITH CHECK (true);

REVOKE ALL ON public.meta_page_sync_holds FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.meta_page_sync_holds TO service_role;

COMMENT ON TABLE public.meta_page_sync_holds IS
  'Pages whose Meta token is broken (Graph 190 / 403 #200 / unverified shared token) and have no platform_oauth_connections row to mark status=error. Hourly syncs skip them until reconnect deletes the row.';
