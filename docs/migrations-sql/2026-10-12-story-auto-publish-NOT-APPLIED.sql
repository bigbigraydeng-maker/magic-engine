-- Story auto-publish (slice 2) — tables.  >>> NOT APPLIED. <<<
-- Apply only after explicit PM approval; on approval move to supabase/migrations/ with a timestamp name.
-- service-role only (RLS policy MUST say TO service_role). Design: docs/specs/2026-10-12-story-auto-publish-design.md §5.

-- 1. PM authorisation of one weekly story pack (pack-level metadata only; item fingerprints live on the item rows).
create table public.story_pack_auth (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  client_id uuid not null,
  pack_id uuid not null,
  authorized_by_email text not null,
  authorized_by_user_id uuid not null,
  authorized_at timestamptz not null default now(),
  -- set only after the authorisation event was sent; publishers act on activated grants only
  activated_at timestamptz,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoked_by_email text,
  revoked_reason text,
  constraint story_pack_auth_expiry_chk check (expires_at > authorized_at)
);

-- one live authorisation per pack at a time
create unique index story_pack_auth_active_pack_idx
  on public.story_pack_auth (pack_id)
  where revoked_at is null;

create index story_pack_auth_client_idx
  on public.story_pack_auth (client_id, authorized_at desc);

-- 2. One row per (item, channel): what is authorised and what the file is.
create table public.story_pack_items (
  item_id uuid not null,
  channel text not null check (channel in ('facebook_story','instagram_story')),
  pack_id uuid not null,
  client_id uuid not null,
  slot_at timestamptz not null,
  media_kind text not null check (media_kind in ('image','video')),
  media_url text not null check (media_url like 'https://%'),
  media_sha256 text not null check (media_sha256 ~ '^[0-9a-f]{64}$'),
  text_line text not null,
  account_id text not null check (account_id ~ '^[0-9]{5,25}$'),
  source_record_ids text[] not null check (cardinality(source_record_ids) >= 1),
  website_ref text not null check (website_ref like 'https://%'),
  website_checked_on date not null,
  has_reply_cta boolean not null default false,
  -- fingerprint the PM authorised for this item (null until authorised)
  authorized_fingerprint text check (authorized_fingerprint is null or authorized_fingerprint ~ '^[0-9a-f]{64}$'),
  authorization_id uuid references public.story_pack_auth(id),
  -- circuit-breaker pause for this single item (reason is a stable code)
  paused_at timestamptz,
  paused_reason text,
  created_at timestamptz not null default now(),
  primary key (item_id, channel)
);

create index story_pack_items_pack_idx on public.story_pack_items (pack_id, slot_at);
create index story_pack_items_client_slot_idx on public.story_pack_items (client_id, slot_at);

-- 3. Server-side evidence that the PM opened an item (bound to the fingerprint they saw).
create table public.story_pack_item_opens (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null,
  channel text not null,
  opened_by_user_id uuid not null,
  opened_fingerprint text not null check (opened_fingerprint ~ '^[0-9a-f]{64}$'),
  opened_at timestamptz not null default now(),
  constraint story_pack_item_opens_item_fk foreign key (item_id, channel)
    references public.story_pack_items (item_id, channel),
  constraint story_pack_item_opens_once_key unique (item_id, channel, opened_by_user_id, opened_fingerprint)
);

-- 4. Atomic claim + outcome per (item, channel).
create table public.story_publish_attempts (
  id uuid primary key default gen_random_uuid(),
  auth_id uuid references public.story_pack_auth(id),
  client_id uuid not null,
  pack_id uuid not null,
  item_id uuid not null,
  channel text not null check (channel in ('facebook_story','instagram_story')),
  attempt_no integer not null default 1 check (attempt_no >= 1),
  status text not null check (status in (
    'DRY_RUN','CLAIMED','CONTAINER_CREATED','PUBLISHING','PUBLISHED_UNVERIFIED','PUBLISHED',
    'BLOCKED','FAILED_FINAL','UNKNOWN_OUTCOME','MISSED_WINDOW','SKIPPED_NOT_AUTHORIZED')),
  reason_code text,
  request_id uuid not null,
  mode text not null check (mode in ('DRY_RUN','LIVE')),
  provider_impact text not null default 'NONE' check (provider_impact in ('NONE','STORY_PUBLISHED')),
  -- Facebook post_id / Instagram media id; never invented, null until a provider returned one
  provider_receipt text,
  -- Instagram two-step publish: the container id is stored before media_publish is called
  container_id text,
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint story_publish_attempts_item_channel_key unique (item_id, channel),
  -- a published status must carry a provider receipt
  constraint story_publish_attempts_receipt_chk check (
    status not in ('PUBLISHED','PUBLISHED_UNVERIFIED') or (provider_receipt is not null and length(trim(provider_receipt)) > 0)
  ),
  -- a dry run can never be recorded as published
  constraint story_publish_attempts_dry_run_chk check (
    mode <> 'DRY_RUN' or status not in ('PUBLISHED','PUBLISHED_UNVERIFIED')
  )
);

create index story_publish_attempts_client_status_idx on public.story_publish_attempts (client_id, status);
create index story_publish_attempts_pack_idx on public.story_publish_attempts (pack_id, channel);

-- RLS: service-role only, on every table (TO service_role is mandatory).
alter table public.story_pack_auth enable row level security;
alter table public.story_pack_items enable row level security;
alter table public.story_pack_item_opens enable row level security;
alter table public.story_publish_attempts enable row level security;

create policy story_pack_auth_service_role on public.story_pack_auth for all to service_role using (true) with check (true);
create policy story_pack_items_service_role on public.story_pack_items for all to service_role using (true) with check (true);
create policy story_pack_item_opens_service_role on public.story_pack_item_opens for all to service_role using (true) with check (true);
create policy story_publish_attempts_service_role on public.story_publish_attempts for all to service_role using (true) with check (true);

revoke all on public.story_pack_auth from anon, authenticated;
revoke all on public.story_pack_items from anon, authenticated;
revoke all on public.story_pack_item_opens from anon, authenticated;
revoke all on public.story_publish_attempts from anon, authenticated;
