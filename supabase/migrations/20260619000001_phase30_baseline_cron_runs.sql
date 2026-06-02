-- Phase 30 S5.3: cron run log for baseline collection
-- Each row = one cron invocation (manual or scheduled).
-- Enables Admin UI to show "last 20 runs" + their success/failure breakdown.

create table if not exists baseline_cron_runs (
  id                 uuid primary key default gen_random_uuid(),

  -- When the run started / finished
  started_at         timestamptz not null default now(),
  completed_at       timestamptz,

  -- Outcome
  status             text not null default 'running'
                     check (status in ('running','completed','partial','failed')),

  -- What got processed
  domains_attempted  integer not null default 0,
  domains_succeeded  integer not null default 0,
  domains_failed     integer not null default 0,
  benchmarks_written integer not null default 0,

  -- Cost / debugging
  duration_seconds   integer,
  error_message      text,
  failure_details    jsonb,        -- array of { domain, sub_industry, error }

  -- Who triggered
  triggered_by       text not null default 'cron'
                     check (triggered_by in ('cron','admin_manual')),

  created_at         timestamptz not null default now()
);

create index if not exists idx_baseline_cron_runs_started_at
  on baseline_cron_runs(started_at desc);

create index if not exists idx_baseline_cron_runs_status
  on baseline_cron_runs(status);

-- RLS: service role only (Admin UI fetches via service-role API route)
alter table baseline_cron_runs enable row level security;
create policy "Service role full access"
  on baseline_cron_runs for all
  using (true) with check (true);
