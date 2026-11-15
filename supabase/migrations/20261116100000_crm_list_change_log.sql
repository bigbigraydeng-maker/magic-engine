-- ════════════════════════════════════════════════════════════════════════════
-- CRM 名单「数据变没变」的记号（第 1 刀）
-- 设计稿：docs/specs/2026-11-16-crm-list-read-once-design-v0.md
--
-- crm_list_change_log  只追加。名单用到的表每发生一次真实改动，就给对应客户记一行。
-- 读名单的服务器数「这个客户有几行」：行数没变 = 数据没变，可以复用上次读到的原始数据。
--
-- 为什么是「只追加一行」而不是「把一个数字加一」：
--   加一要改同一行，两个同时写同一客户的事务会互相等，多步事务还可能死锁，
--   等于给客人表和联系记录表的每次写入加了一个新的失败方式。追加一行不等任何人。
-- 为什么版本用「行数」而不是「最大编号」：
--   先拿到编号的事务可能后提交。只看最大编号会漏掉它；行数每提交一次必变。
--
-- 这一刀不改任何页面行为：只多记一行。撤回办法见文件末尾。
-- ════════════════════════════════════════════════════════════════════════════

create table public.crm_list_change_log (
  id bigint generated always as identity primary key,
  -- 故意不加外键：这张表只是记号，任何情况下都不能因为它让业务表的写入失败。
  client_id uuid not null,
  changed_at timestamptz not null default now()
);

create index crm_list_change_log_client_idx
  on public.crm_list_change_log (client_id, id);

comment on table public.crm_list_change_log is
  'CRM 名单输入表的改动记号，只追加。某客户的行数没变 = 名单的输入没变。设计稿 2026-11-16。';

alter table public.crm_list_change_log enable row level security;

create policy crm_list_change_log_service_role
  on public.crm_list_change_log
  for all
  to service_role
  using (true)
  with check (true);

revoke all on public.crm_list_change_log from anon, authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 触发器函数。SECURITY DEFINER：不管是谁在写业务表，这一行记号都要能记上；
-- search_path 置空 + 全部写全名，避免被同名对象劫持。
-- UPDATE 只在行内容真的变了才记（to_jsonb 比较对任何列类型都成立，不会因为某列
-- 没有比较运算符而报错）。同步任务会原样重写很多行，不滤掉的话记号会一直变。
-- ────────────────────────────────────────────────────────────────────────────

-- 带 client_id 列的表共用。
create or replace function public.crm_list_change_log_by_client()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.crm_list_change_log (client_id)
    select distinct n.client_id from new_rows n where n.client_id is not null;
  elsif tg_op = 'DELETE' then
    insert into public.crm_list_change_log (client_id)
    select distinct o.client_id from old_rows o where o.client_id is not null;
  else
    insert into public.crm_list_change_log (client_id)
    select distinct x.client_id
    from (
      select o.client_id as old_client, n.client_id as new_client
      from old_rows o
      join new_rows n on n.id = o.id
      where to_jsonb(o) is distinct from to_jsonb(n)
    ) changed
    cross join lateral (values (changed.old_client), (changed.new_client)) as x (client_id)
    where x.client_id is not null;
  end if;
  return null;
end;
$$;

-- conversation_messages 没有 client_id，要经 conversations 找到客户。
create or replace function public.crm_list_change_log_by_conversation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.crm_list_change_log (client_id)
    select distinct c.client_id
    from new_rows n join public.conversations c on c.id = n.conversation_id;
  elsif tg_op = 'DELETE' then
    insert into public.crm_list_change_log (client_id)
    select distinct c.client_id
    from old_rows o join public.conversations c on c.id = o.conversation_id;
  else
    insert into public.crm_list_change_log (client_id)
    select distinct c.client_id
    from old_rows o
    join new_rows n on n.id = o.id
    join public.conversations c on c.id in (o.conversation_id, n.conversation_id)
    where to_jsonb(o) is distinct from to_jsonb(n);
  end if;
  return null;
end;
$$;

-- clients：只有名单会读的两列变了才记。
create or replace function public.crm_list_change_log_for_client_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.crm_list_change_log (client_id) values (new.id);
  return null;
end;
$$;

revoke all on function public.crm_list_change_log_by_client() from public, anon, authenticated;
revoke all on function public.crm_list_change_log_by_conversation() from public, anon, authenticated;
revoke all on function public.crm_list_change_log_for_client_row() from public, anon, authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 挂到名单读取的每一张表上。语句级 + 过渡表：一条语句不管改多少行，每个客户只记一行。
-- ────────────────────────────────────────────────────────────────────────────
do $$
declare
  t text;
begin
  foreach t in array array[
    'contacts', 'contact_touchpoints', 'contact_identities', 'conversations',
    'conversation_briefs', 'contact_stage_events', 'client_pipeline_stages', 'tailor_made_itineraries'
  ] loop
    execute format(
      'create trigger crm_list_change_log_ins after insert on public.%I
         referencing new table as new_rows
         for each statement execute function public.crm_list_change_log_by_client()', t);
    execute format(
      'create trigger crm_list_change_log_upd after update on public.%I
         referencing old table as old_rows new table as new_rows
         for each statement execute function public.crm_list_change_log_by_client()', t);
    execute format(
      'create trigger crm_list_change_log_del after delete on public.%I
         referencing old table as old_rows
         for each statement execute function public.crm_list_change_log_by_client()', t);
  end loop;
end;
$$;

create trigger crm_list_change_log_ins after insert on public.conversation_messages
  referencing new table as new_rows
  for each statement execute function public.crm_list_change_log_by_conversation();
create trigger crm_list_change_log_upd after update on public.conversation_messages
  referencing old table as old_rows new table as new_rows
  for each statement execute function public.crm_list_change_log_by_conversation();
create trigger crm_list_change_log_del after delete on public.conversation_messages
  referencing old table as old_rows
  for each statement execute function public.crm_list_change_log_by_conversation();

create trigger crm_list_change_log_upd after update of leads_config, country on public.clients
  for each row
  when (old.leads_config is distinct from new.leads_config or old.country is distinct from new.country)
  execute function public.crm_list_change_log_for_client_row();

-- ────────────────────────────────────────────────────────────────────────────
-- 撤回（整段可直接执行；业务表数据不受影响）：
--   drop trigger if exists crm_list_change_log_ins on public.<上面 9 张表>;
--   drop trigger if exists crm_list_change_log_upd on public.<上面 9 张表和 clients>;
--   drop trigger if exists crm_list_change_log_del on public.<上面 9 张表>;
--   drop function if exists public.crm_list_change_log_by_client();
--   drop function if exists public.crm_list_change_log_by_conversation();
--   drop function if exists public.crm_list_change_log_for_client_row();
--   drop table if exists public.crm_list_change_log;
-- ────────────────────────────────────────────────────────────────────────────
