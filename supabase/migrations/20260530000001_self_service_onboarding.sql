-- P20.0.1: Self-service onboarding — link public scan jobs to clients
-- Allows a prospect's scan result to be claimed and attached to their new client record.

ALTER TABLE public_scan_jobs
  ADD COLUMN IF NOT EXISTS client_id uuid REFERENCES clients(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_public_scan_jobs_client_id
  ON public_scan_jobs(client_id);

COMMENT ON COLUMN public_scan_jobs.client_id IS
  'P20.0: Set after prospect claims their workspace via /api/onboard/self. Null for unclaimed scans.';
