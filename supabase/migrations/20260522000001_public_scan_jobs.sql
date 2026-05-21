-- Public scan jobs — anonymous full Zhangqian discovery scans from the
-- public landing page. Results keyed by UUID only; no user account needed.

create table if not exists public_scan_jobs (
  id            uuid        primary key default gen_random_uuid(),
  url           text        not null,
  domain        text        not null,
  email         text,
  name          text,
  status        text        not null default 'queued'
                            check (status in ('queued','running','completed','failed')),
  -- Structured log: array of { type, icon, message, detail?, ts }
  -- Appended as discoveries are made (real-time feed on the results page)
  progress_log  jsonb       not null default '[]'::jsonb,
  result        jsonb,
  error         text,
  created_at    timestamptz not null default now(),
  completed_at  timestamptz
);

create index if not exists public_scan_jobs_created
  on public_scan_jobs (created_at desc);
