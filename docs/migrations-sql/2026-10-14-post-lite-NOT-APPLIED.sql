-- Post "lite" auto-publish — 2 tables.  >>> NOT APPLIED. <<<
-- Apply only after explicit PM approval ("建表合并"). service-role only (every policy MUST say TO service_role).
-- Sibling of the Story lite tables (2026-10-12-story-lite-NOT-APPLIED.sql); same shape on purpose.
-- Design: docs/specs/2026-10-14-post-lite-design.md
--
-- Rollback (nothing else references these tables): drop table public.post_items; drop table public.post_packs;

-- 1. A weekly pack of Facebook photo Posts. Authorisation lives on the pack: one PM click, then stop = revoke.
create table public.post_packs (
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
  constraint post_packs_auth_all_or_none_chk check (
    (authorized_at is null and authorized_by_email is null and authorized_by_user_id is null
       and expires_at is null and authorized_content_hash is null)
    or (authorized_at is not null and authorized_by_email is not null and authorized_by_user_id is not null
       and expires_at is not null and authorized_content_hash is not null and expires_at > authorized_at)
  ),
  constraint post_packs_revoke_all_or_none_chk check (
    (revoked_at is null and revoked_by_email is null and revoked_reason is null)
    or (revoked_at is not null and revoked_by_email is not null and revoked_reason is not null)
  )
);

-- lets items bind (pack_id, client_id) so an item can never belong to a different client than its pack
alter table public.post_packs add constraint post_packs_id_client_key unique (id, client_id);

create index post_packs_client_idx on public.post_packs (client_id, created_at desc);
create index post_packs_live_idx on public.post_packs (expires_at) where authorized_at is not null and revoked_at is null;

-- 2. One row per Post (Facebook only today; the channel check can be widened later without touching rows).
create table public.post_items (
  item_id uuid primary key default gen_random_uuid(),
  pack_id uuid not null,
  client_id uuid not null,
  channel text not null default 'facebook_post' check (channel in ('facebook_post')),
  slot_at timestamptz not null,
  -- public https URL of the picture (our own public storage); its sha256 is re-checked right before sending
  media_url text not null check (media_url like 'https://%'),
  media_sha256 text not null check (media_sha256 ~ '^[0-9a-f]{64}$'),
  -- what the picture is: a pure text card is blocked at preview ("原则上不做"); the reviewer, not code, decides which
  visual_kind text not null check (visual_kind in ('photo','text_card')),
  -- Post body (no link, no tracking params: the link lives in the first comment)
  message text not null check (length(trim(message)) between 1 and 2000),
  -- first comment: call to action + the tracked official-site link
  first_comment text not null check (length(trim(first_comment)) between 1 and 1000),
  account_id text not null check (account_id ~ '^[0-9]{5,25}$'),
  -- the client_assets row that backs this picture (its `source` decides whether a real price may sit next to it);
  -- the price gate reads the source from this row, never by URL lookup. Part of the fingerprint.
  asset_id uuid not null,
  -- the `client_assets.source` seen when the preview was built / the pack authorised; part of the fingerprint.
  -- Re-read right before sending: a changed source blocks the item (a label edited after approval cannot unlock a price claim).
  asset_source text not null check (length(trim(asset_source)) > 0),
  -- the official-website page the claims were checked against (https)
  source_ref text not null check (source_ref like 'https://%'),
  -- content role chosen by the planner; free short label, shown in preview, never decides sending
  role text check (role is null or length(trim(role)) between 1 and 40),
  -- fact-library ids behind the copy (audit pointer only)
  fact_refs text[] not null default '{}',
  status text not null default 'PENDING' check (status in
    ('PENDING','CLAIMED','SENT','UNKNOWN_OUTCOME','FAILED','BLOCKED','MISSED')),
  -- this item's fingerprint when the PM authorised the pack; compared again right before sending
  authorized_fingerprint text check (authorized_fingerprint is null or authorized_fingerprint ~ '^[0-9a-f]{64}$'),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  claimed_at timestamptz,
  sent_at timestamptz,
  -- the Facebook feed post id: never invented, null until Facebook returned one
  provider_receipt text,
  -- what that id is: the feed post (usable for first comment / read-back / any later take-down) or only the photo object
  -- (Facebook gave no feed post id: first comment goes to a human, and nothing may delete or read back by this id)
  provider_receipt_kind text check (provider_receipt_kind is null or provider_receipt_kind in ('feed_post','photo_object')),
  -- first comment is written after the Post is out; a failure here never re-sends the Post.
  -- NONE = not yet written, POSTING = a sweep took it (claimed by conditional update), POSTED, FAILED = retry within the window,
  -- NEEDS_HUMAN = cannot be written automatically (e.g. Facebook gave no feed post id): goes to today's to-do
  first_comment_status text not null default 'NONE' check (first_comment_status in ('NONE','POSTING','POSTED','FAILED','NEEDS_HUMAN')),
  first_comment_id text,
  first_comment_reason text,
  first_comment_attempts integer not null default 0 check (first_comment_attempts >= 0),
  first_comment_attempted_at timestamptz,
  reason_code text,
  last_check_at timestamptz,
  last_check_result text,
  created_at timestamptz not null default now(),
  -- a sent Post must carry its receipt
  constraint post_items_sent_receipt_chk check (
    status <> 'SENT' or (provider_receipt is not null and length(trim(provider_receipt)) > 0 and sent_at is not null)
  ),
  -- only a sent Post, or one whose outcome is unknown (a human may settle it from the page), has a receipt
  constraint post_items_receipt_only_when_sent_chk check (status in ('SENT','UNKNOWN_OUTCOME') or provider_receipt is null),
  -- a receipt always says what kind of id it is, and only then
  constraint post_items_receipt_kind_chk check ((provider_receipt is null) = (provider_receipt_kind is null)),
  -- a posted first comment needs a feed post id
  constraint post_items_comment_needs_feed_post_chk check (first_comment_status <> 'POSTED' or provider_receipt_kind = 'feed_post'),
  -- a claimed item says when it was claimed (stale-claim detection)
  constraint post_items_claimed_at_chk check (status <> 'CLAIMED' or claimed_at is not null),
  -- every non-happy end state says why
  constraint post_items_reason_chk check (
    status not in ('BLOCKED','FAILED','UNKNOWN_OUTCOME','MISSED') or (reason_code is not null and length(trim(reason_code)) > 0)
  ),
  -- the first comment only exists for a sent Post
  constraint post_items_comment_only_when_sent_chk check (status = 'SENT' or first_comment_status = 'NONE'),
  constraint post_items_comment_id_chk check (
    (first_comment_status = 'POSTED') = (first_comment_id is not null and length(trim(first_comment_id)) > 0)
  ),
  -- the same picture twice in one pack is "same first frame": refused at the door
  constraint post_items_pack_media_unique unique (pack_id, media_sha256),
  constraint post_items_pack_fk foreign key (pack_id, client_id) references public.post_packs (id, client_id)
);

create index post_items_pack_idx on public.post_items (pack_id, slot_at);
-- "same picture recently" check at preview/send time (counts SENT, CLAIMED and UNKNOWN_OUTCOME)
create index post_items_client_media_idx on public.post_items (client_id, media_sha256);

alter table public.post_packs enable row level security;
alter table public.post_items enable row level security;

create policy post_packs_service_role on public.post_packs for all to service_role using (true) with check (true);
create policy post_items_service_role on public.post_items for all to service_role using (true) with check (true);

revoke all on public.post_packs from anon, authenticated;
revoke all on public.post_items from anon, authenticated;
