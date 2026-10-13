-- ===========================================================================================
-- SUPERSEDED — DO NOT APPLY.  (2026-10-12, PM: "最小版")
-- This 8-table design was judged over-built for 18 stories a week and one client. It is replaced by
-- docs/migrations-sql/2026-10-12-story-lite-NOT-APPLIED.sql (2 tables). Kept only as a record.
-- ===========================================================================================
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
  if old.revoked_at is not null and (new.revoked_at is distinct from old.revoked_at
     or new.revoked_by_email is distinct from old.revoked_by_email
     or new.revoked_reason is distinct from old.revoked_reason) then
    raise exception 'story_pack_auth: a revocation is write-once';
  end if;
  return new;
end $$;

create trigger story_pack_auth_freeze_trg before update on public.story_pack_auth
  for each row execute function public.story_pack_auth_freeze();

-- one live authorisation per pack at a time (an expired but un-revoked grant still occupies it:
-- re-authorising a pack must revoke the old grant first — the authorise endpoint must do that)
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
  -- declared at ingest; the authorise endpoint requires the PM to have opened every item that
  -- shows a price, names a place, or is a video (covered by the fingerprint and the content lock)
  contains_price boolean not null default false,
  names_place boolean not null default false,
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
  if new.item_id is distinct from old.item_id or new.channel is distinct from old.channel then
    raise exception 'story_pack_items: the key (item_id, channel) is immutable';
  end if;
  -- the authorisation link cannot be cleared or swapped while the old grant is still live
  if old.authorization_id is not null
     and new.authorization_id is distinct from old.authorization_id
     and exists (select 1 from public.story_pack_auth a where a.id = old.authorization_id and a.revoked_at is null) then
    raise exception 'story_pack_items: the authorisation link is locked while the grant is live';
  end if;
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
       or new.has_reply_cta is distinct from old.has_reply_cta
       or new.contains_price is distinct from old.contains_price
       or new.names_place is distinct from old.names_place) then
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
    references public.story_pack_items (item_id, channel)
);

-- One row per person, item, version and UTC day: clicking twice in a day is one record, but opening the
-- same unchanged item again on a later day writes a NEW row (an open only counts for 24 hours, so the
-- person must be able to renew it; the rows themselves are write-once).
create unique index story_pack_item_opens_once_per_day_idx
  on public.story_pack_item_opens (item_id, channel, opened_by_user_id, opened_fingerprint, ((opened_at at time zone 'UTC')::date));

-- Open records are evidence: never edited, never deleted.
create function public.story_opens_freeze() returns trigger language plpgsql as $$
begin
  raise exception 'story_pack_item_opens rows are write-once';
end $$;
create trigger story_pack_item_opens_freeze_trg before update or delete on public.story_pack_item_opens
  for each row execute function public.story_opens_freeze();

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
  settled_by_email text,
  settled_reason text,
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
    channel <> 'instagram_story' or status not in ('CONTAINER_CREATED','PUBLISHING') or container_id is not null
  ),
  -- a retryable row always knows when it may be retried
  constraint story_publish_attempts_retry_chk check (status <> 'RETRYABLE' or next_retry_at is not null),
  -- who settled an unknown outcome by hand, and why (set together with the status change)
  constraint story_publish_attempts_settled_chk check ((settled_by_email is null) = (settled_reason is null))
);

create index story_publish_attempts_client_status_idx on public.story_publish_attempts (client_id, status);
create index story_publish_attempts_pack_idx on public.story_publish_attempts (pack_id, channel);

-- updated_at moves only when the status changes, so a same-status write (e.g. a retry counter)
-- can never reset the stale-claim / stale-publishing clocks the gate reads.
create function public.story_touch_updated_at() returns trigger language plpgsql as $$
begin
  if new.status is distinct from old.status then
    new.updated_at = now();
  else
    new.updated_at = old.updated_at;
  end if;
  return new;
end $$;

create trigger story_publish_attempts_touch_trg before update on public.story_publish_attempts
  for each row execute function public.story_touch_updated_at();

-- Outcomes only move along allowed transitions (a white list), so a published / in-flight row can
-- never be rolled back to a state that would be sent again. UNKNOWN_OUTCOME may only be settled by a
-- human, who must be recorded.
create function public.story_publish_attempts_no_rollback() returns trigger language plpgsql as $$
begin
  -- receipts and container ids are write-once once present
  if old.provider_receipt is not null and new.provider_receipt is distinct from old.provider_receipt then
    raise exception 'story_publish_attempts: provider_receipt is write-once';
  end if;
  if old.container_id is not null and new.container_id is distinct from old.container_id then
    raise exception 'story_publish_attempts: container_id is write-once';
  end if;
  if old.status in ('PUBLISHED','PUBLISHED_UNVERIFIED','FAILED_FINAL','MISSED_WINDOW','UNKNOWN_OUTCOME')
     and (new.mode is distinct from old.mode
       or new.content_hash is distinct from old.content_hash
       or new.auth_id is distinct from old.auth_id
       or new.request_id is distinct from old.request_id
       or new.item_id is distinct from old.item_id
       or new.channel is distinct from old.channel) then
    raise exception 'story_publish_attempts: settled rows keep their identity fields';
  end if;
  if old.settled_by_email is not null
     and (new.settled_by_email is distinct from old.settled_by_email or new.settled_reason is distinct from old.settled_reason) then
    raise exception 'story_publish_attempts: the settlement record is write-once';
  end if;
  if new.status = old.status then
    return new;
  end if;
  if not (
       (old.status in ('DRY_RUN','BLOCKED','SKIPPED_NOT_AUTHORIZED')
          and new.status in ('DRY_RUN','BLOCKED','SKIPPED_NOT_AUTHORIZED','MISSED_WINDOW','RETRYABLE','CLAIMED'))
    or (old.status = 'RETRYABLE' and new.status in ('CLAIMED','BLOCKED','MISSED_WINDOW'))
    or (old.status = 'CLAIMED' and new.status in ('CONTAINER_CREATED','PUBLISHED_UNVERIFIED','BLOCKED','RETRYABLE','FAILED_FINAL','UNKNOWN_OUTCOME','MISSED_WINDOW'))
    or (old.status = 'CONTAINER_CREATED' and new.status in ('PUBLISHING','FAILED_FINAL','UNKNOWN_OUTCOME'))
    or (old.status = 'PUBLISHING' and new.status in ('PUBLISHED_UNVERIFIED','FAILED_FINAL','UNKNOWN_OUTCOME'))
    or (old.status = 'PUBLISHED_UNVERIFIED' and new.status = 'PUBLISHED')
    or (old.status = 'UNKNOWN_OUTCOME' and new.status in ('PUBLISHED_UNVERIFIED','PUBLISHED','FAILED_FINAL'))
  ) then
    raise exception 'story_publish_attempts: transition % -> % is not allowed', old.status, new.status;
  end if;
  if old.status = 'UNKNOWN_OUTCOME' and (new.settled_by_email is null or new.settled_reason is null) then
    raise exception 'story_publish_attempts: settling an unknown outcome must record who and why';
  end if;
  return new;
end $$;

create trigger story_publish_attempts_no_rollback_trg before update on public.story_publish_attempts
  for each row execute function public.story_publish_attempts_no_rollback();

-- NOTE (Facebook): a Facebook story has no container step, so it goes CLAIMED -> PUBLISHED_UNVERIFIED
-- directly (the CLAIMED row is the claim taken before the send; a crash is caught by the stale-claim rule).
-- PUBLISHING exists for the two-step Instagram flow only.

-- 5. Per (pack, channel) publish lease: only one sweep may be sending for a pack+channel at a time.
-- Use story_take_lease(): it creates the row on first use and takes over only a free or expired lease.
create table public.story_pack_lease (
  pack_id uuid not null,
  channel text not null check (channel in ('facebook_story','instagram_story')),
  holder uuid,
  expires_at timestamptz,
  primary key (pack_id, channel),
  constraint story_pack_lease_pair_chk check ((holder is null) = (expires_at is null))
);

create function public.story_take_lease(p_pack uuid, p_channel text, p_holder uuid, p_ttl interval)
returns boolean language plpgsql as $$
declare n integer;
begin
  if p_ttl is null or p_ttl <= interval '0' then
    raise exception 'story_take_lease: ttl must be positive';
  end if;
  -- a free lease, an expired lease, or the holder renewing its own lease may be taken
  insert into public.story_pack_lease as l (pack_id, channel, holder, expires_at)
  values (p_pack, p_channel, p_holder, now() + p_ttl)
  on conflict (pack_id, channel) do update
    set holder = excluded.holder, expires_at = excluded.expires_at
    where l.holder is null or l.expires_at < now() or l.holder = excluded.holder;
  get diagnostics n = row_count;
  return n = 1;
end $$;

-- Hand the lease back as soon as the send is done so the next item of the pack can go this sweep.
-- Only the current holder can release it.
create function public.story_release_lease(p_pack uuid, p_channel text, p_holder uuid)
returns boolean language plpgsql as $$
declare n integer;
begin
  update public.story_pack_lease
     set holder = null, expires_at = null
   where pack_id = p_pack and channel = p_channel and holder = p_holder;
  get diagnostics n = row_count;
  return n = 1;
end $$;

-- functions are executable by PUBLIC by default: lock them to the service role
revoke all on function public.story_take_lease(uuid, text, uuid, interval) from public, anon, authenticated;
grant execute on function public.story_take_lease(uuid, text, uuid, interval) to service_role;
revoke all on function public.story_release_lease(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.story_release_lease(uuid, text, uuid) to service_role;

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

-- Who is on duty to answer replies, per client and day. A story that invites replies is blocked
-- when nobody is on duty that day. Maintained by a person (owner: 74), read by the gate.
create table public.story_reply_duty (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null,
  duty_date date not null,
  on_duty_email text not null check (position('@' in on_duty_email) > 1),
  created_by_email text not null,
  created_at timestamptz not null default now(),
  constraint story_reply_duty_once_key unique (client_id, duty_date, on_duty_email)
);

-- Circuit-breaker marks: the publisher writes one when a pack/channel (item_id null) or a single item
-- must stop. A mark is lifted by a person, never by the publisher.
create table public.story_pack_pauses (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null,
  pack_id uuid not null,
  channel text check (channel is null or channel in ('facebook_story','instagram_story')),
  item_id uuid,
  reason_code text not null,
  created_by text not null,
  created_at timestamptz not null default now(),
  lifted_at timestamptz,
  lifted_by_email text,
  constraint story_pack_pauses_lift_chk check ((lifted_at is null) = (lifted_by_email is null)),
  constraint story_pack_pauses_scope_chk check (item_id is null or channel is not null)
);

create index story_pack_pauses_active_idx on public.story_pack_pauses (pack_id, channel) where lifted_at is null;

-- Records are never deleted (an authorisation or an attempt is evidence).
create function public.story_no_delete() returns trigger language plpgsql as $$
begin
  raise exception '% rows are never deleted', tg_table_name;
end $$;

create trigger story_pack_auth_no_delete_trg before delete on public.story_pack_auth
  for each row execute function public.story_no_delete();
create trigger story_pack_items_no_delete_trg before delete on public.story_pack_items
  for each row execute function public.story_no_delete();
create trigger story_publish_attempts_no_delete_trg before delete on public.story_publish_attempts
  for each row execute function public.story_no_delete();

-- RLS: service-role only, on every table (TO service_role is mandatory).
alter table public.story_pack_auth enable row level security;
alter table public.story_pack_items enable row level security;
alter table public.story_pack_item_opens enable row level security;
alter table public.story_publish_attempts enable row level security;
alter table public.story_pack_lease enable row level security;
alter table public.story_reply_duty enable row level security;
alter table public.story_pack_pauses enable row level security;
alter table public.story_asset_usage enable row level security;

create policy story_pack_auth_service_role on public.story_pack_auth for all to service_role using (true) with check (true);
create policy story_pack_items_service_role on public.story_pack_items for all to service_role using (true) with check (true);
create policy story_pack_item_opens_service_role on public.story_pack_item_opens for all to service_role using (true) with check (true);
create policy story_publish_attempts_service_role on public.story_publish_attempts for all to service_role using (true) with check (true);
create policy story_reply_duty_service_role on public.story_reply_duty for all to service_role using (true) with check (true);
create policy story_pack_pauses_service_role on public.story_pack_pauses for all to service_role using (true) with check (true);
create policy story_pack_lease_service_role on public.story_pack_lease for all to service_role using (true) with check (true);
create policy story_asset_usage_service_role on public.story_asset_usage for all to service_role using (true) with check (true);

revoke all on public.story_pack_auth from anon, authenticated;
revoke all on public.story_pack_items from anon, authenticated;
revoke all on public.story_pack_item_opens from anon, authenticated;
revoke all on public.story_publish_attempts from anon, authenticated;
revoke all on public.story_pack_lease from anon, authenticated;
revoke all on public.story_reply_duty from anon, authenticated;
revoke all on public.story_pack_pauses from anon, authenticated;
revoke all on public.story_asset_usage from anon, authenticated;
