-- 供应商回调原始事件（P1 只接 Resend 的系统邮件账号）：一行一个回调事件，只增不改不删。
-- service-role only。A 级（新表 + 触发器）：生产应用前必须先预检，并等 PM 回「go apply」。
-- 本迁移不含任何客户数据；只新增对象，不改任何旧表。
-- 设计稿：docs/specs/2026-11-01-me-provider-event-intake-p1-design-v0.md §3.2。
--
-- 只增不改不删：触发器强制（service_role 能绕过 RLS，所以不能只靠「代码不改」）。
-- 擦除与保留期清理由库所有者在控制台手动执行事务（先 DISABLE TRIGGER 再 DELETE 再 ENABLE TRIGGER），
-- 不建专用角色、也不建擦除函数；自动清理任务属后续阶段的 A 级改动。

-- ────────────────────────────────────────────────────────────────────────────
-- 1. provider_webhook_events —— 供应商回调原始事件，一行一个事件
-- ────────────────────────────────────────────────────────────────────────────
create table public.provider_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider ~ '^[a-z][a-z0-9_]{1,30}$'),
  account text not null check (account ~ '^[a-z][a-z0-9_]{1,30}$'),
  provider_event_id text not null check (char_length(provider_event_id) between 1 and 200),
  event_type text not null check (char_length(event_type) between 1 and 80),
  provider_message_id text check (provider_message_id is null or char_length(provider_message_id) between 1 and 200),
  occurred_at timestamptz,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  received_at timestamptz not null default now(),
  constraint provider_webhook_events_event_key unique (provider, account, provider_event_id)
);

comment on table public.provider_webhook_events is
  '供应商回调原始事件，只增不改不删；payload 已去掉主题并清洗；唯一键 provider+account+事件号。';

-- ────────────────────────────────────────────────────────────────────────────
-- 2. 只增不改不删：触发器强制（行级 UPDATE / DELETE + 语句级 TRUNCATE）
--    仓库先例：20260808000003_me2_execution_kernel_v1.sql 的 authorization_decisions_append_only
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.provider_webhook_events_append_only()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception '% is append-only: % is not allowed', tg_table_name, tg_op
    using errcode = 'restrict_violation';
end;
$$;

revoke all on function public.provider_webhook_events_append_only() from public, anon, authenticated;

create trigger provider_webhook_events_append_only
  before update or delete on public.provider_webhook_events
  for each row execute function public.provider_webhook_events_append_only();
create trigger provider_webhook_events_no_truncate
  before truncate on public.provider_webhook_events
  for each statement execute function public.provider_webhook_events_append_only();

-- ────────────────────────────────────────────────────────────────────────────
-- 3. RLS：service-role 模板（必须带 TO service_role，漏掉 = 对匿名访客敞开读写）
-- ────────────────────────────────────────────────────────────────────────────
alter table public.provider_webhook_events enable row level security;

create policy provider_webhook_events_service_role
  on public.provider_webhook_events
  for all
  to service_role
  using (true)
  with check (true);

revoke all on public.provider_webhook_events from anon, authenticated;
