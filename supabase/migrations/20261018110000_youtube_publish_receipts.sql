-- service-role only; apply only after explicit PM approval.
-- YouTube publishing: per-client channel id (client configuration), per-stage receipts,
-- and one-time authorisation grants (the nonce is consumed atomically before any publish step).

alter table public.clients
  add column if not exists youtube_channel_id text
  check (youtube_channel_id is null or youtube_channel_id ~ '^UC[A-Za-z0-9_-]{22}$');

create table public.youtube_publish_receipts (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  client_id uuid not null references public.clients(id),
  channel_id text not null,
  stage text not null check (stage in ('staging', 'public_step')),
  status text not null check (status in ('pending', 'blocked', 'staged', 'dry_run_ok', 'published', 'failed')),
  reason text,
  -- the factory work order the video came from; staging refuses anything else
  work_order_id uuid references public.content_work_orders(id),
  video_id text,
  -- true whenever nothing public was created by this step
  no_publish boolean not null default true,
  authorization_nonce uuid,
  authorized_by text,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index youtube_publish_receipts_client_idx
  on public.youtube_publish_receipts (client_id, created_at desc);
create index youtube_publish_receipts_video_idx
  on public.youtube_publish_receipts (client_id, video_id) where video_id is not null;

create table public.youtube_publish_authorizations (
  nonce uuid primary key,
  client_id uuid not null references public.clients(id),
  channel_id text not null,
  video_id text not null,
  granted_by text not null,
  granted_at timestamptz not null default now(),
  -- a grant is only consumable inside this window (checked atomically in the consume update)
  expires_at timestamptz not null default (now() + interval '30 minutes'),
  consumed_at timestamptz
);

alter table public.youtube_publish_receipts enable row level security;
alter table public.youtube_publish_authorizations enable row level security;
create policy "service_role_full" on public.youtube_publish_receipts
  for all to service_role using (true) with check (true);
create policy "service_role_full" on public.youtube_publish_authorizations
  for all to service_role using (true) with check (true);

-- Reversible: drop both tables and the clients.youtube_channel_id column.
