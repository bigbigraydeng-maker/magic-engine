-- CTS 员工电话（VoIPLine）接入第一块：连接配置 / 原始事件 / 通话 / 拒绝回执 + 私有录音桶。
-- service-role only。A 级（新表 + 新存储桶）：生产应用前必须先预检，并等 PM 回「同意」。
-- 本迁移不含任何客户数据、令牌或号码。

create table public.telephony_connections (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  provider text not null check (provider in ('voipline')),
  provider_account_id text not null,
  -- SHA-256(令牌)，库里不存令牌本身
  webhook_token_hash text not null,
  default_country text not null default 'NZ' check (default_country in ('NZ', 'AU')),
  -- 分机号 -> 员工登录邮箱
  extension_map jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (provider, provider_account_id),
  unique (client_id, provider)
);

create table public.telephony_raw_events (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  connection_id uuid not null references public.telephony_connections(id) on delete cascade,
  provider text not null,
  provider_call_id text not null,
  raw_type text not null,
  dedupe_key text not null unique,
  received_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'processed', 'failed', 'ignored')),
  attempts int not null default 0,
  last_error text,
  processed_at timestamptz,
  normalised jsonb not null,
  -- 原样载荷：含客人号码、录音链接。只有 service_role 能读，保存期限待 PM 定（见 docs/clients/cts/）
  payload jsonb not null
);
create index telephony_raw_events_call_idx on public.telephony_raw_events (client_id, connection_id, provider_call_id);
create index telephony_raw_events_sweep_idx on public.telephony_raw_events (status, received_at);

create table public.telephony_webhook_rejections (
  id uuid primary key default gen_random_uuid(),
  -- 刻意不加外键：来自未知连接的请求也要留回执
  connection_id uuid,
  client_id uuid,
  reason text not null,
  received_at timestamptz not null,
  -- 仅「令牌通过但读不懂」时保存载荷（含号码；只有 service_role 可读），用来校准字段别名；未认证请求不存
  payload jsonb
);
create index telephony_webhook_rejections_time_idx on public.telephony_webhook_rejections (received_at desc);

create table public.telephony_calls (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  connection_id uuid not null references public.telephony_connections(id) on delete cascade,
  provider text not null,
  provider_call_id text not null,
  stage text not null check (stage in ('unknown', 'started', 'answered', 'ended')),
  direction text check (direction in ('inbound', 'outbound')),
  started_at timestamptz not null,
  counterparty_e164 text,
  answered boolean not null default false,
  talk_seconds int not null default 0,
  extension text,
  staff_email text,
  legs jsonb not null default '[]'::jsonb,
  contact_id uuid references public.contacts(id) on delete set null,
  match_status text not null default 'pending'
    check (match_status in ('pending', 'matched', 'created', 'needs_review', 'unmatched_outbound', 'not_applicable')),
  crm_status text not null default 'pending'
    check (crm_status in ('pending', 'written', 'needs_review', 'skipped', 'failed')),
  crm_detail text,
  touchpoint_id uuid,
  recording_ref text,
  recording_raw_event_id uuid references public.telephony_raw_events(id) on delete set null,
  recording_status text not null default 'none'
    check (recording_status in ('none', 'pending_download', 'downloaded', 'failed')),
  transcript_status text not null default 'not_started'
    check (transcript_status in ('not_started', 'pending', 'done', 'failed')),
  summary_status text not null default 'not_started'
    check (summary_status in ('not_started', 'pending', 'done', 'failed')),
  -- 转写和摘要都真实成功并经人复核之前永远 false
  learning_eligible boolean not null default false check (learning_eligible = false or (transcript_status = 'done' and summary_status = 'done')),
  receipts jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, provider, provider_call_id)
);
create index telephony_calls_review_idx on public.telephony_calls (client_id, crm_status) where crm_status in ('needs_review', 'failed');
create index telephony_calls_recording_idx on public.telephony_calls (client_id, recording_status) where recording_status <> 'none';

alter table public.telephony_connections enable row level security;
alter table public.telephony_raw_events enable row level security;
alter table public.telephony_webhook_rejections enable row level security;
alter table public.telephony_calls enable row level security;

create policy telephony_connections_service_role on public.telephony_connections for all to service_role using (true) with check (true);
create policy telephony_raw_events_service_role on public.telephony_raw_events for all to service_role using (true) with check (true);
create policy telephony_webhook_rejections_service_role on public.telephony_webhook_rejections for all to service_role using (true) with check (true);
create policy telephony_calls_service_role on public.telephony_calls for all to service_role using (true) with check (true);

revoke all on public.telephony_connections from anon, authenticated;
revoke all on public.telephony_raw_events from anon, authenticated;
revoke all on public.telephony_webhook_rejections from anon, authenticated;
revoke all on public.telephony_calls from anon, authenticated;

-- 私有录音桶：不公开，不给任何 storage 策略（只有 service_role 能读写）。路径约定：<client_id>/<yyyy>/<provider_call_id>
insert into storage.buckets (id, name, public) values ('telephony-recordings', 'telephony-recordings', false)
on conflict (id) do update set public = false;
