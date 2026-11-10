-- ════════════════════════════════════════════════════════════════════════════
-- CRM 邮件「按团追踪点击」（刀 B2）
-- 设计稿：docs/specs/2026-11-10-crm-email-click-tracking-b2-design-v0.md §7
--
-- crm_email_link_tokens  发信时给每封信里每个可追踪链接发的编号（一封信一个网址一个编号）
-- crm_email_link_clicks  客人的网站回传的点击（只存分类，不存 IP、不存完整浏览器标识）
--
-- 客人被删除时，编号和点击一并删除（on delete cascade）。
-- 点击不写进 contact_touchpoints 的 inbound 行：否则会被当成「客人回来了」。
-- ════════════════════════════════════════════════════════════════════════════

create table public.crm_email_link_tokens (
  token text primary key check (token ~ '^[A-Za-z0-9]{12}$'),
  client_id uuid not null references public.clients(id),
  contact_id uuid not null references public.contacts(id) on delete cascade,
  -- 那一次「点发送」的请求号；和 conversation_outbound_log.meta_message_id 里的 req:<id> 对得上
  request_id uuid not null,
  url text not null check (char_length(url) between 1 and 600),
  kind text not null check (kind in ('catalogue', 'tour', 'all_tours', 'other')),
  -- 发编号那一刻的快照：{name, destination, tier, slug, departOn}，团下架后记录仍看得懂
  tour jsonb check (tour is null or jsonb_typeof(tour) = 'object'),
  created_at timestamptz not null default now()
);

create index crm_email_link_tokens_request_idx
  on public.crm_email_link_tokens (client_id, request_id);
create index crm_email_link_tokens_contact_idx
  on public.crm_email_link_tokens (client_id, contact_id, created_at desc);

create table public.crm_email_link_clicks (
  id uuid primary key default gen_random_uuid(),
  token text not null references public.crm_email_link_tokens(token) on delete cascade,
  client_id uuid not null references public.clients(id),
  contact_id uuid not null references public.contacts(id) on delete cascade,
  occurred_at timestamptz not null default now(),
  path text check (path is null or char_length(path) <= 300),
  method text not null check (method in ('GET', 'HEAD')),
  ua_class text not null check (ua_class in ('browser', 'scanner', 'unknown')),
  -- 疑似邮箱自动检查（HEAD / 已知检查程序 / 不是用户点开的导航 / 离发出 60 秒内）：记下但不算客人点击
  suspected_scan boolean not null,
  -- 「真人点击」：不是疑似检查 + 离发出超过 10 分钟 + 像用户点开的整页导航。第 2 天提醒只认这个
  counts_as_human boolean not null
);

create index crm_email_link_clicks_contact_idx
  on public.crm_email_link_clicks (client_id, contact_id, occurred_at desc);
create index crm_email_link_clicks_token_idx
  on public.crm_email_link_clicks (token, occurred_at desc);

comment on table public.crm_email_link_tokens is
  'CRM 员工一对一发信时给可追踪链接发的编号（?me=）。只增不改。设计稿 2026-11-10 B2。';
comment on table public.crm_email_link_clicks is
  '客人网站回传的邮件链接点击。不存 IP 和完整浏览器标识。suspected_scan=疑似邮箱自动检查；counts_as_human=算客人点击。';

-- RLS：service-role 模板（必须带 TO service_role，漏掉 = 对匿名访客敞开读写）
alter table public.crm_email_link_tokens enable row level security;
alter table public.crm_email_link_clicks enable row level security;

create policy crm_email_link_tokens_service_role
  on public.crm_email_link_tokens
  for all
  to service_role
  using (true)
  with check (true);

create policy crm_email_link_clicks_service_role
  on public.crm_email_link_clicks
  for all
  to service_role
  using (true)
  with check (true);
