-- CRM「通话后选模板发邮件」：邮件模板 / 发信设置 / 发送回执（3 张追加型表）。
-- service-role only。A 级（新表 + 追加触发器）：生产应用前必须先预检，并等 PM 回「go apply」。
-- 本迁移不含任何客户数据、令牌、邮箱地址或邮件正文；只新增对象，不改任何旧表。
-- 设计稿：docs/specs/2026-10-28-crm-post-call-email-templates-design-v0.md §5（子牙、魏征各审一轮）。
--
-- 三张表都是「只增不改」：一行写入后不许 UPDATE / DELETE / TRUNCATE，由触发器强制（service_role 能绕过 RLS，
-- 所以不能只靠「代码不改」）。「当前版」= 同一 key 最大的 version；停用 / 启用 / 改设置都是写一个新版本。
-- 不加 on delete cascade：删客户时若还有这些行会被拒，这是有意的（先处理审计再删）。

-- ────────────────────────────────────────────────────────────────────────────
-- 1. crm_email_templates —— 邮件模板，一版一行
-- ────────────────────────────────────────────────────────────────────────────
create table public.crm_email_templates (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id),
  template_key text not null check (template_key ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  version integer not null check (version >= 1),
  name text not null check (char_length(name) between 1 and 120),
  -- 含占位符的模板文本；渲染后另限 200（应用层）
  subject text not null check (char_length(subject) between 1 and 400),
  body text not null check (char_length(body) between 1 and 10000),
  -- 'none' | 'published_tours'：应用层白名单校验，换行业不用改表
  fact_source text not null default 'none' check (char_length(fact_source) between 1 and 40),
  pick_mode text not null default 'none' check (pick_mode in ('none', 'one', 'many')),
  pick_filter jsonb not null default '{}'::jsonb check (jsonb_typeof(pick_filter) = 'object'),
  status text not null check (status in ('active', 'disabled')),
  change_note text check (change_note is null or char_length(change_note) <= 300),
  created_by text not null check (char_length(created_by) between 3 and 254),
  created_at timestamptz not null default now(),
  constraint crm_email_templates_version_key unique (client_id, template_key, version)
);

comment on table public.crm_email_templates is
  '邮件模板，一版一行、只增不改。当前版 = 同 key 最大 version；停用/启用也是新版本。发送只认当前版且 status=active。';

-- ────────────────────────────────────────────────────────────────────────────
-- 2. crm_email_settings —— 发信设置，一版一行（独立于 clients.leads_config，避免被整块写回悄悄覆盖）
-- ────────────────────────────────────────────────────────────────────────────
create table public.crm_email_settings (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id),
  version integer not null check (version >= 1),
  -- 严格解析（应用层）：坏值或缺键 = 拒发，绝不回落成默认
  settings jsonb not null check (jsonb_typeof(settings) = 'object'),
  change_note text check (change_note is null or char_length(change_note) <= 300),
  created_by text not null check (char_length(created_by) between 3 and 254),
  created_at timestamptz not null default now(),
  constraint crm_email_settings_version_key unique (client_id, version)
);

comment on table public.crm_email_settings is
  '发信设置（总开关、灰度名单、频次上限、文字红线…），一版一行、只增不改；当前设置 = 最大 version。';

-- ────────────────────────────────────────────────────────────────────────────
-- 3. crm_email_send_receipts —— 发送回执（每次发信尝试一行；不存收件人邮箱和正文）
-- ────────────────────────────────────────────────────────────────────────────
create table public.crm_email_send_receipts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id),
  -- 软引用，不加外键：回执是审计日志，不能因联系人 / 会话被删而写不进
  contact_id uuid not null,
  request_id uuid not null,
  actor_email text not null check (char_length(actor_email) between 3 and 254),
  template_key text check (template_key is null or template_key ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  template_version integer check (template_version is null or template_version >= 1),
  catalog_version integer check (catalog_version is null or catalog_version >= 0),
  call_basis text not null default 'none' check (call_basis in ('none', 'system_call', 'staff_attested')),
  outcome text not null check (outcome in ('sent', 'blocked', 'failed', 'unknown')),
  block_reason text check (block_reason is null or char_length(block_reason) <= 60),
  block_detail text check (block_detail is null or char_length(block_detail) <= 300),
  mailbox text check (mailbox is null or char_length(mailbox) <= 254),
  -- 软引用：audit_failed 路径会把会话删掉，外键会让这条回执永远写不进
  conversation_id uuid,
  provider_message_id text check (provider_message_id is null or char_length(provider_message_id) <= 512),
  edited_after_render boolean,
  warnings text[] not null default '{}',
  rendered_sha256 text check (rendered_sha256 is null or rendered_sha256 ~ '^[0-9a-f]{64}$'),
  final_sha256 text check (final_sha256 is null or final_sha256 ~ '^[0-9a-f]{64}$'),
  -- 注意：authorization 是 PostgreSQL 保留字，不能当列名
  auth_basis text not null default 'human_click' check (auth_basis = 'human_click'),
  created_at timestamptz not null default now(),
  -- 被拦必须写原因；已发出的不许带原因；失败 / 状态不明可带可不带（如 internal_error）
  constraint crm_email_send_receipts_block_reason_matches check (
    (outcome <> 'blocked' or block_reason is not null)
    and (outcome <> 'sent' or block_reason is null)
  )
);

-- 幂等：同一客人同一个请求号的同一种结果（含同一原因）只写一次。写入方用普通 insert，遇到 23505 当已写过
-- （表达式索引不能被 upsert(onConflict) 使用）。
create unique index crm_email_send_receipts_attempt_key
  on public.crm_email_send_receipts (client_id, contact_id, request_id, outcome, coalesce(block_reason, ''));
create index crm_email_send_receipts_recent_idx
  on public.crm_email_send_receipts (client_id, created_at desc);
create index crm_email_send_receipts_contact_idx
  on public.crm_email_send_receipts (client_id, contact_id, created_at desc);

comment on table public.crm_email_send_receipts is
  '每次发信尝试（sent/blocked/failed/unknown）一行回执，只增不改；不存收件人邮箱和邮件正文（正文在 conversation_outbound_log）。';

-- ────────────────────────────────────────────────────────────────────────────
-- 4. 只增不改：触发器强制（行级 UPDATE / DELETE + 语句级 TRUNCATE）
--    仓库先例：20260808000003_me2_execution_kernel_v1.sql 的 authorization_decisions_append_only
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.crm_email_append_only()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception '% is append-only: % is not allowed', tg_table_name, tg_op
    using errcode = 'restrict_violation';
end;
$$;

revoke all on function public.crm_email_append_only() from public, anon, authenticated;

create trigger crm_email_templates_append_only
  before update or delete on public.crm_email_templates
  for each row execute function public.crm_email_append_only();
create trigger crm_email_templates_no_truncate
  before truncate on public.crm_email_templates
  for each statement execute function public.crm_email_append_only();

create trigger crm_email_settings_append_only
  before update or delete on public.crm_email_settings
  for each row execute function public.crm_email_append_only();
create trigger crm_email_settings_no_truncate
  before truncate on public.crm_email_settings
  for each statement execute function public.crm_email_append_only();

create trigger crm_email_send_receipts_append_only
  before update or delete on public.crm_email_send_receipts
  for each row execute function public.crm_email_append_only();
create trigger crm_email_send_receipts_no_truncate
  before truncate on public.crm_email_send_receipts
  for each statement execute function public.crm_email_append_only();

-- ────────────────────────────────────────────────────────────────────────────
-- 5. RLS：service-role 模板（必须带 TO service_role，漏掉 = 对匿名访客敞开读写）
-- ────────────────────────────────────────────────────────────────────────────
alter table public.crm_email_templates enable row level security;
alter table public.crm_email_settings enable row level security;
alter table public.crm_email_send_receipts enable row level security;

create policy crm_email_templates_service_role
  on public.crm_email_templates
  for all
  to service_role
  using (true)
  with check (true);

create policy crm_email_settings_service_role
  on public.crm_email_settings
  for all
  to service_role
  using (true)
  with check (true);

create policy crm_email_send_receipts_service_role
  on public.crm_email_send_receipts
  for all
  to service_role
  using (true)
  with check (true);

revoke all on public.crm_email_templates from anon, authenticated;
revoke all on public.crm_email_settings from anon, authenticated;
revoke all on public.crm_email_send_receipts from anon, authenticated;
