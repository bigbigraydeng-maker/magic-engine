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
  -- frozen at authorisation time; see story_pack_auth_freeze trigger
  manifest_hash text not null check (manifest_hash ~ '^[0-9a-f]{64}$'),
  approved_item_fingerprints jsonb not null check (jsonb_typeof(approved_item_fingerprints) = 'object'),
  constraint story_pack_auth_expiry_chk check (expires_at > authorized_at),
  constraint story_pack_auth_activation_chk check (activated_at is null or activated_at >= authorized_at)
);

-- Everything the PM approved is write-once: only activation and revocation may change afterwards.
create function public.story_pack_auth_freeze() returns trigger language plpgsql as $$
begin
  if new.request_id is distinct from old.request_id
     or new.client_id is distinct from old.client_id
     or new.pack_id is distinct from old.pack_id
     or new.authorized_by_email is distinct from old.authorized_by_email
     or new.authorized_by_user_id is distinct from old.authorized_by_user_id
     or new.authorized_at is distinct from old.authorized_at
     or new.expires_at is distinct from old.expires_at
     or new.manifest_hash is distinct from old.manifest_hash
     or new.approved_item_fingerprints is distinct from old.approved_item_fingerprints then
    raise exception 'story_pack_auth: approved fields are write-once';
  end if;
  if old.activated_at is not null and new.activated_at is distinct from old.activated_at then
    raise exception 'story_pack_auth: activated_at is write-once';
  end if;
  if old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at then
    raise exception 'story_pack_auth: a revocation cannot be undone';
  end if;
  return new;
end $$;

create trigger story_pack_auth_freeze_trg before update on public.story_pack_auth
  for each row execute function public.story_pack_auth_freeze();

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
  text_line text not null check (length(trim(text_line)) between 1 and 200),
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

-- While an item is covered by a live (not revoked) authorisation its content is locked;
-- only pause fields, the authorisation link and the stored fingerprint may change.
create function public.story_pack_items_lock_content() returns trigger language plpgsql as $$
begin
  if old.authorization_id is not null
     and exists (select 1 from public.story_pack_auth a where a.id = old.authorization_id and a.revoked_at is null)
     and (new.pack_id is distinct from old.pack_id
       or new.client_id is distinct from old.client_id
       or new.slot_at is distinct from old.slot_at
       or new.media_kind is distinct from old.media_kind
       or new.media_url is distinct from old.media_url
       or new.media_sha256 is distinct from old.media_sha256
       or new.text_line is distinct from old.text_line
       or new.account_id is distinct from old.account_id
       or new.source_record_ids is distinct from old.source_record_ids
       or new.website_ref is distinct from old.website_ref
       or new.website_checked_on is distinct from old.website_checked_on
       or new.has_reply_cta is distinct from old.has_reply_cta) then
    raise exception 'story_pack_items: content is locked while a live authorisation covers it';
  end if;
  return new;
end $$;

create trigger story_pack_items_lock_content_trg before update on public.story_pack_items
  for each row execute function public.story_pack_items_lock_content();

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
    'DRY_RUN','CLAIMED','RETRYABLE','CONTAINER_CREATED','PUBLISHING','PUBLISHED_UNVERIFIED','PUBLISHED',
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
  next_retry_at timestamptz,
  retry_count integer not null default 0 check (retry_count >= 0),
  -- set when the publish right is taken (status PUBLISHING); the stale-publish sweep reads it
  publish_started_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint story_publish_attempts_item_channel_key unique (item_id, channel),
  constraint story_publish_attempts_item_fk foreign key (item_id, channel)
    references public.story_pack_items (item_id, channel),
  -- a published status must carry a provider receipt and a live authorisation link
  constraint story_publish_attempts_receipt_chk check (
    status not in ('PUBLISHED','PUBLISHED_UNVERIFIED')
    or (provider_receipt is not null and length(trim(provider_receipt)) > 0 and auth_id is not null)
  ),
  -- provider impact is exactly "a story was published"
  constraint story_publish_attempts_impact_chk check (
    (status in ('PUBLISHED','PUBLISHED_UNVERIFIED')) = (provider_impact = 'STORY_PUBLISHED')
  ),
  -- a dry run can never be recorded as published
  constraint story_publish_attempts_dry_run_chk check (
    mode <> 'DRY_RUN' or status not in ('PUBLISHED','PUBLISHED_UNVERIFIED')
  ),
  -- the two-step Instagram states always know their container
  constraint story_publish_attempts_container_chk check (
    status not in ('CONTAINER_CREATED','PUBLISHING') or container_id is not null
  )
);

create index story_publish_attempts_client_status_idx on public.story_publish_attempts (client_id, status);
create index story_publish_attempts_pack_idx on public.story_publish_attempts (pack_id, channel);

create function public.story_touch_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create trigger story_publish_attempts_touch_trg before update on public.story_publish_attempts
  for each row execute function public.story_touch_updated_at();

-- Outcomes only move forward: a published / failed / missed row can never be rolled back,
-- PUBLISHED_UNVERIFIED may only be confirmed, UNKNOWN_OUTCOME may only be settled by a human.
create function public.story_publish_attempts_no_rollback() returns trigger language plpgsql as $$
begin
  if new.status = old.status then
    return new;
  end if;
  if old.status in ('PUBLISHED','FAILED_FINAL','MISSED_WINDOW') then
    raise exception 'story_publish_attempts: % is final', old.status;
  end if;
  if old.status = 'PUBLISHED_UNVERIFIED' and new.status <> 'PUBLISHED' then
    raise exception 'story_publish_attempts: PUBLISHED_UNVERIFIED can only become PUBLISHED';
  end if;
  if old.status = 'UNKNOWN_OUTCOME' and new.status not in ('PUBLISHED_UNVERIFIED','PUBLISHED','FAILED_FINAL') then
    raise exception 'story_publish_attempts: UNKNOWN_OUTCOME can only be settled to a confirmed outcome';
  end if;
  return new;
end $$;

create trigger story_publish_attempts_no_rollback_trg before update on public.story_publish_attempts
  for each row execute function public.story_publish_attempts_no_rollback();

-- 5. Per (pack, channel) publish lease: only one sweep may be sending for a pack+channel at a time.
-- Take it with: update ... set holder = :run, expires_at = now() + :ttl
--               where pack_id = :p and channel = :c and (holder is null or expires_at < now())  -- 1 row = got it
create table public.story_pack_lease (
  pack_id uuid not null,
  channel text not null check (channel in ('facebook_story','instagram_story')),
  holder uuid,
  expires_at timestamptz,
  primary key (pack_id, channel)
);

-- 6. Where each media file has already been used (Facebook refuses a Story built from a file that was
-- already published as a post / reel). Written by the Post / Reel publishers; a missing row means "unknown".
create table public.story_asset_usage (
  id uuid primary key default gen_random_uuid(),
  media_sha256 text not null check (media_sha256 ~ '^[0-9a-f]{64}$'),
  used_in text not null check (used_in in ('post','reel','story')),
  used_ref text not null,
  used_at timestamptz not null default now(),
  constraint story_asset_usage_once_key unique (media_sha256, used_in, used_ref)
);

create index story_asset_usage_sha_idx on public.story_asset_usage (media_sha256);

-- RLS: service-role only, on every table (TO service_role is mandatory).
alter table public.story_pack_auth enable row level security;
alter table public.story_pack_items enable row level security;
alter table public.story_pack_item_opens enable row level security;
alter table public.story_publish_attempts enable row level security;
alter table public.story_pack_lease enable row level security;
alter table public.story_asset_usage enable row level security;

create policy story_pack_auth_service_role on public.story_pack_auth for all to service_role using (true) with check (true);
create policy story_pack_items_service_role on public.story_pack_items for all to service_role using (true) with check (true);
create policy story_pack_item_opens_service_role on public.story_pack_item_opens for all to service_role using (true) with check (true);
create policy story_publish_attempts_service_role on public.story_publish_attempts for all to service_role using (true) with check (true);
create policy story_pack_lease_service_role on public.story_pack_lease for all to service_role using (true) with check (true);
create policy story_asset_usage_service_role on public.story_asset_usage for all to service_role using (true) with check (true);

revoke all on public.story_pack_auth from anon, authenticated;
revoke all on public.story_pack_items from anon, authenticated;
revoke all on public.story_pack_item_opens from anon, authenticated;
revoke all on public.story_publish_attempts from anon, authenticated;
revoke all on public.story_pack_lease from anon, authenticated;
revoke all on public.story_asset_usage from anon, authenticated;
