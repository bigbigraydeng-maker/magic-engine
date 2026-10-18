-- service-role only; apply only after explicit PM approval.
-- Follow-up to 20261018110000 (already applied): adds the 'pending' receipt status
-- (written right before an upload so a crash cannot cause a blind re-upload) and a
-- 30-minute expiry on one-time publish grants. RLS policies are unchanged.

alter table public.youtube_publish_receipts
  drop constraint if exists youtube_publish_receipts_status_check;
alter table public.youtube_publish_receipts
  add constraint youtube_publish_receipts_status_check
  check (status in ('pending', 'blocked', 'staged', 'dry_run_ok', 'published', 'failed'));

alter table public.youtube_publish_authorizations
  add column if not exists expires_at timestamptz not null default (now() + interval '30 minutes');

-- Grants that already exist expire 30 minutes after they were granted, not after this migration.
update public.youtube_publish_authorizations
  set expires_at = granted_at + interval '30 minutes'
  where consumed_at is null;

-- Reversible: drop the expires_at column; delete 'pending' rows, then restore the old
-- check without 'pending'.
