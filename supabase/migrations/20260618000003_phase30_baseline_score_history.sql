-- Phase 30 S5.1: Time-series snapshot of baseline domain scores
-- Each row = one collect run for one domain. Never updated, never deleted.
-- Enables trend analysis: "barfoot.co.nz 6-month trajectory", "Auckland RE P50 over time".

create table if not exists baseline_domain_score_history (
  id                   uuid primary key default gen_random_uuid(),

  baseline_domain_id   uuid not null references baseline_domains(id) on delete cascade,

  -- Snapshot of identifying fields (in case the domain row is later deleted / renamed)
  industry             text not null,
  sub_industry         text not null,
  domain               text not null,

  -- The actual score collected
  dimension            text not null default 'seo',
  score                integer not null,

  collected_at         timestamptz not null default now()
);

create index if not exists idx_score_history_domain_time
  on baseline_domain_score_history (baseline_domain_id, collected_at desc);

create index if not exists idx_score_history_sub_industry_time
  on baseline_domain_score_history (sub_industry, collected_at desc);

-- RLS: service role only
alter table baseline_domain_score_history enable row level security;
create policy "Service role full access"
  on baseline_domain_score_history for all
  using (true) with check (true);

-- Backfill: seed initial history rows from current baseline_domains
-- so the first snapshot is preserved (otherwise we lose the "starting point").
insert into baseline_domain_score_history
  (baseline_domain_id, industry, sub_industry, domain, dimension, score, collected_at)
select
  id, industry, sub_industry, domain, 'seo', seo_score, coalesce(last_collected_at, now())
from baseline_domains
where seo_score is not null;
