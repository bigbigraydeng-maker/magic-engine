-- service-role only; apply only after explicit PM approval.
-- Records PM acceptance of brief-deviation quality flags (e.g. narrator voice mismatch)
-- so the review page can stop re-surfacing the same flag for the same brief.

create table public.factory_review_flag_acceptances (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null,
  work_order_id uuid not null,
  category text not null check (category = 'narrator_voice_mismatch'),
  brief_fingerprint text not null check (brief_fingerprint ~ '^[0-9a-f]{64}$'),
  accepted_by text not null,
  note text,
  accepted_at timestamptz not null default now()
);

create index factory_review_flag_acceptances_lookup_idx
  on public.factory_review_flag_acceptances (client_id, category, brief_fingerprint);

alter table public.factory_review_flag_acceptances enable row level security;

create policy factory_review_flag_acceptances_service_role
  on public.factory_review_flag_acceptances
  for all
  to service_role
  using (true)
  with check (true);

revoke all on public.factory_review_flag_acceptances from anon, authenticated;
