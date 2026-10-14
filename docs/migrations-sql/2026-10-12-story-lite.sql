-- Story "lite" auto-publish — 2 tables.  APPLIED to prod 2026-10-12 08:51 UTC (migration 20261012_story_lite_tables, PM "建表").
-- service-role only (every policy MUST say TO service_role). Rollback: drop table public.story_items; drop table public.story_packs;
-- Replaces the superseded 8-table draft (2026-10-12-story-auto-publish-NOT-APPLIED.sql).
-- Design: docs/specs/2026-10-12-story-lite-design.md

-- 1. A weekly pack of stories. Authorisation lives on the pack: one PM click, then stop = revoke.
create table public.story_packs (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null,
  title text not null check (length(trim(title)) between 1 and 120),
  created_at timestamptz not null default now(),
  authorized_at timestamptz,
  authorized_by_email text,
  authorized_by_user_id uuid,
  expires_at timestamptz,
  -- the preview hash the person confirmed
  authorized_content_hash text check (authorized_content_hash is null or authorized_content_hash ~ '^[0-9a-f]{64}$'),
  revoked_at timestamptz,
  revoked_by_email text,
  revoked_reason text,
  constraint story_packs_auth_all_or_none_chk check (
    (authorized_at is null and authorized_by_email is null and authorized_by_user_id is null
       and expires_at is null and authorized_content_hash is null)
    or (authorized_at is not null and authorized_by_email is not null and authorized_by_user_id is not null
       and expires_at is not null and authorized_content_hash is not null and expires_at > authorized_at)
  ),
  constraint story_packs_revoke_all_or_none_chk check (
    (revoked_at is null and revoked_by_email is null and revoked_reason is null)
    or (revoked_at is not null and revoked_by_email is not null and revoked_reason is not null)
  )
);

create index story_packs_client_idx on public.story_packs (client_id, created_at desc);
create index story_packs_live_idx on public.story_packs (expires_at) where authorized_at is not null and revoked_at is null;

-- 2. One row per story (Facebook only today; the column allows Instagram later without a migration).
create table public.story_items (
  item_id uuid primary key default gen_random_uuid(),
  pack_id uuid not null references public.story_packs(id),
  client_id uuid not null,
  channel text not null default 'facebook_story' check (channel in ('facebook_story','instagram_story')),
  slot_at timestamptz not null,
  media_kind text not null check (media_kind in ('image','video')),
  media_url text not null check (media_url like 'https://%'),
  media_sha256 text not null check (media_sha256 ~ '^[0-9a-f]{64}$'),
  text_line text not null check (length(trim(text_line)) between 1 and 200),
  account_id text not null check (account_id ~ '^[0-9]{5,25}$'),
  source_ref text not null check (source_ref like 'https://%'),
  status text not null default 'PENDING' check (status in
    ('PENDING','CLAIMED','SENT','UNKNOWN_OUTCOME','FAILED','BLOCKED','MISSED')),
  -- this item's fingerprint when the PM authorised the pack; compared again right before sending
  authorized_fingerprint text check (authorized_fingerprint is null or authorized_fingerprint ~ '^[0-9a-f]{64}$'),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  claimed_at timestamptz,
  sent_at timestamptz,
  -- the Facebook story id: never invented, null until Facebook returned one
  provider_receipt text,
  reason_code text,
  last_check_at timestamptz,
  last_check_result text,
  created_at timestamptz not null default now(),
  -- a sent story must carry its receipt
  constraint story_items_sent_receipt_chk check (
    status <> 'SENT' or (provider_receipt is not null and length(trim(provider_receipt)) > 0 and sent_at is not null)
  ),
  -- only a sent story has a receipt
  constraint story_items_receipt_only_when_sent_chk check (status = 'SENT' or provider_receipt is null)
);

create index story_items_pack_idx on public.story_items (pack_id, slot_at);
create index story_items_due_idx on public.story_items (slot_at) where status in ('PENDING','CLAIMED');

alter table public.story_packs enable row level security;
alter table public.story_items enable row level security;

create policy story_packs_service_role on public.story_packs for all to service_role using (true) with check (true);
create policy story_items_service_role on public.story_items for all to service_role using (true) with check (true);

revoke all on public.story_packs from anon, authenticated;
revoke all on public.story_items from anon, authenticated;
