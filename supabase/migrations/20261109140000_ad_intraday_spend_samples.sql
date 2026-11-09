-- Intraday spend samples for the close-of-day forecast.
-- One new table. No changes to existing tables. Do not apply in this PR.
-- Rows older than 14 days are deleted by the sampler. service-role only.

create table public.ad_intraday_spend_samples (
  id              uuid primary key default gen_random_uuid(),
  client_id       uuid not null references public.clients(id) on delete restrict,
  ad_account_id   text not null check (char_length(ad_account_id) between 4 and 64),
  account_day     date not null,
  sampled_at      timestamptz not null,
  local_minute    integer not null check (local_minute >= 0 and local_minute <= 1430 and local_minute % 10 = 0),
  entity_level    text not null check (entity_level in ('campaign', 'adset')),
  entity_id       text not null check (char_length(entity_id) between 1 and 64),
  spend_minor     integer not null check (spend_minor >= 0),
  impressions     integer check (impressions is null or impressions >= 0),
  currency        text check (currency is null or char_length(currency) between 3 and 8),
  timezone        text not null check (char_length(timezone) between 1 and 64),
  created_at      timestamptz not null default now(),
  constraint ad_intraday_spend_samples_tick unique (
    client_id, ad_account_id, account_day, local_minute, entity_level, entity_id
  )
);

comment on table public.ad_intraday_spend_samples is
  'Read-only Meta spend samples during the ad account local day. 14-day retention. No budget writes.';

create index ad_intraday_spend_samples_client_day_idx
  on public.ad_intraday_spend_samples (client_id, ad_account_id, account_day, local_minute);

create index ad_intraday_spend_samples_sampled_at_idx
  on public.ad_intraday_spend_samples (sampled_at);

alter table public.ad_intraday_spend_samples enable row level security;

create policy ad_intraday_spend_samples_service_role
  on public.ad_intraday_spend_samples
  for all
  to service_role
  using (true)
  with check (true);

revoke all on public.ad_intraday_spend_samples from anon, authenticated;
