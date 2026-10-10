-- service-role only; apply only after explicit PM approval.
-- Records PM authorisation of a reviewed daily plan for automatic Facebook publishing,
-- plus one row per plan date acting as the atomic claim and tombstone for each publish attempt.

create table public.daily_plan_auto_publish_auth (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  client_id uuid not null,
  campaign_id uuid not null,
  plan_id uuid not null,
  plan_revision text not null,
  review_revision text not null,
  page_id text not null check (page_id ~ '^[0-9]{5,25}$'),
  dates text[] not null check (cardinality(dates) between 1 and 31),
  -- dates the PM explicitly re-allowed after a recall; the publisher treats `recalled[]` as final except for these
  lifted_dates text[] not null default '{}',
  max_per_day integer not null default 1 check (max_per_day between 1 and 3),
  authorized_by_email text not null,
  authorized_by_user_id uuid not null,
  authorized_at timestamptz not null default now(),
  -- set only after the authorisation event was sent; the publisher acts on activated grants only
  activated_at timestamptz,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoked_by_email text,
  revoked_reason text,
  constraint daily_plan_auto_publish_auth_expiry_chk check (expires_at > authorized_at)
);

create unique index daily_plan_auto_publish_auth_active_plan_idx
  on public.daily_plan_auto_publish_auth (plan_id)
  where revoked_at is null;

create index daily_plan_auto_publish_auth_client_idx
  on public.daily_plan_auto_publish_auth (client_id, authorized_at desc);

alter table public.daily_plan_auto_publish_auth enable row level security;

create policy daily_plan_auto_publish_auth_service_role
  on public.daily_plan_auto_publish_auth
  for all
  to service_role
  using (true)
  with check (true);

revoke all on public.daily_plan_auto_publish_auth from anon, authenticated;

create table public.daily_plan_auto_publish_attempts (
  id uuid primary key default gen_random_uuid(),
  -- null for a tombstone written when no grant is active (e.g. recall after revoke)
  auth_id uuid references public.daily_plan_auto_publish_auth(id),
  client_id uuid not null,
  plan_id uuid not null,
  date text not null check (date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  attempt_no integer not null default 1 check (attempt_no >= 1),
  status text not null check (status in ('claimed','published','blocked','failed_retryable','failed_final','unknown_outcome','missed_window','dry_run')),
  reason_code text,
  request_id uuid not null,
  provider_impact text not null default 'NONE' check (provider_impact in ('NONE','FB_SCHEDULED')),
  post_id text,
  scheduled_publish_time timestamptz,
  next_retry_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint daily_plan_auto_publish_attempts_plan_date_key unique (plan_id, date)
);

create index daily_plan_auto_publish_attempts_client_status_idx
  on public.daily_plan_auto_publish_attempts (client_id, status);

alter table public.daily_plan_auto_publish_attempts enable row level security;

create policy daily_plan_auto_publish_attempts_service_role
  on public.daily_plan_auto_publish_attempts
  for all
  to service_role
  using (true)
  with check (true);

revoke all on public.daily_plan_auto_publish_attempts from anon, authenticated;
