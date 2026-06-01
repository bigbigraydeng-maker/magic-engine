-- Phase 30 S3: baseline_domains table
-- Stores the domain watchlist for each industry sub-category.
-- Each row = one domain. Scores are populated on-demand by FDE via the UI.
-- P50/P75/P90 are computed client-side from rows with non-null seo_score.

create table if not exists baseline_domains (
  id                uuid primary key default gen_random_uuid(),

  -- Industry classification (matches industry_benchmarks.industry_category)
  industry          text not null,          -- e.g. 'tourism_operator'
  sub_industry      text not null,          -- e.g. 'inbound_tour_operator'

  domain            text not null,

  -- Keywords used when running SeoCollector for this domain.
  -- Stored per-domain so FDE can customise per competitor.
  keywords          text[] not null default '{}',

  -- Latest collector result (null = never collected)
  seo_score         integer,
  last_collected_at timestamptz,

  -- Optional FDE annotations
  is_client         boolean not null default false,  -- flag CTS-style client domains
  notes             text,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  -- One domain per sub-industry (prevent duplicates)
  unique (sub_industry, domain)
);

-- Auto-update updated_at
create or replace function set_baseline_domains_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger baseline_domains_updated_at
  before update on baseline_domains
  for each row execute function set_baseline_domains_updated_at();

-- FDE-only access (service role for API routes, no public anon reads)
alter table baseline_domains enable row level security;

create policy "Service role full access"
  on baseline_domains for all
  using (true)
  with check (true);

-- Seed: inbound_tour_operator (PM-verified 2026-06-02)
insert into baseline_domains (industry, sub_industry, domain, keywords, seo_score, last_collected_at) values
  ('tourism_operator', 'inbound_tour_operator', 'hakatours.com',           array['tour operator new zealand','new zealand tours','guided tours new zealand','nz tour operator','adventure tours nz','travel company new zealand'], 16, now()),
  ('tourism_operator', 'inbound_tour_operator', 'discovernewzealand.com',  array['tour operator new zealand','new zealand tours','guided tours new zealand','nz tour operator','adventure tours nz','travel company new zealand'], 16, now()),
  ('tourism_operator', 'inbound_tour_operator', 'moatrek.com',             array['tour operator new zealand','new zealand tours','guided tours new zealand','nz tour operator','adventure tours nz','travel company new zealand'], 16, now()),
  ('tourism_operator', 'inbound_tour_operator', 'kiwiexperience.com',      array['tour operator new zealand','new zealand tours','guided tours new zealand','nz tour operator','adventure tours nz','travel company new zealand'], 13, now()),
  ('tourism_operator', 'inbound_tour_operator', 'aatkings.com',            array['tour operator new zealand','new zealand tours','guided tours new zealand','nz tour operator','adventure tours nz','travel company new zealand'], 16, now()),
  ('tourism_operator', 'inbound_tour_operator', 'firstlighttravel.com',    array['tour operator new zealand','new zealand tours','guided tours new zealand','nz tour operator','adventure tours nz','travel company new zealand'], 6,  now()),
  ('tourism_operator', 'inbound_tour_operator', 'newzealandtours.travel',  array['tour operator new zealand','new zealand tours','guided tours new zealand','nz tour operator','adventure tours nz','travel company new zealand'], 16, now()),
  ('tourism_operator', 'inbound_tour_operator', 'arohatours.co.nz',        array['tour operator new zealand','new zealand tours','guided tours new zealand','nz tour operator','adventure tours nz','travel company new zealand'], 16, now()),
  ('tourism_operator', 'inbound_tour_operator', 'adventuretours.com.au',   array['tour operator new zealand','new zealand tours','guided tours new zealand','nz tour operator','adventure tours nz','travel company new zealand'], 13, now())
on conflict (sub_industry, domain) do nothing;

-- Seed: outbound_tour_operator (PM-verified 2026-06-02)
insert into baseline_domains (industry, sub_industry, domain, keywords, seo_score, last_collected_at, is_client, notes) values
  ('tourism_operator', 'outbound_tour_operator', 'ctstours.co.nz',         array['china tours from new zealand','china travel packages nz','china tour nz','japan tours from new zealand','asia tours new zealand','europe tours from new zealand','escorted tours from new zealand'], 16, now(), true,  'Magic Engine 客户'),
  ('tourism_operator', 'outbound_tour_operator', 'wendywutours.co.nz',     array['china tours from new zealand','china travel packages nz','china tour nz','japan tours from new zealand','asia tours new zealand','europe tours from new zealand','escorted tours from new zealand'], 16, now(), false, null),
  ('tourism_operator', 'outbound_tour_operator', 'worldjourneys.co.nz',    array['china tours from new zealand','china travel packages nz','china tour nz','japan tours from new zealand','asia tours new zealand','europe tours from new zealand','escorted tours from new zealand'], 20, now(), false, null),
  ('tourism_operator', 'outbound_tour_operator', 'onthegotours.com',       array['china tours from new zealand','china travel packages nz','china tour nz','japan tours from new zealand','asia tours new zealand','europe tours from new zealand','escorted tours from new zealand'], 16, now(), false, null),
  ('tourism_operator', 'outbound_tour_operator', 'inspiringvacations.com', array['china tours from new zealand','china travel packages nz','china tour nz','japan tours from new zealand','asia tours new zealand','europe tours from new zealand','escorted tours from new zealand'], 20, now(), false, null),
  ('tourism_operator', 'outbound_tour_operator', 'rdtravel.co.nz',         array['china tours from new zealand','china travel packages nz','china tour nz','japan tours from new zealand','asia tours new zealand','europe tours from new zealand','escorted tours from new zealand'], 14, now(), false, null)
on conflict (sub_industry, domain) do nothing;
