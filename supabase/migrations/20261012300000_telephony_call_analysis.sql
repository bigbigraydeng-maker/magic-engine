-- 通话转写与分析：转写正文表、待复核的分析表、连接上的「允许分析」开关（默认关）、通话行的进度列。
-- A 级（新表 + 改已上线表 + 客人通话内容）：生产应用前必须先预检并等 PM 回「同意」。不含任何数据。

alter table public.telephony_connections add column if not exists analysis_enabled boolean not null default false;
-- 只处理「开关打开之后」才开始的通话；打开之前录的（同意书之前的）历史录音永远不回捞
alter table public.telephony_connections add column if not exists analysis_enabled_at timestamptz;
-- 开关由 false 变 true 的那一刻，数据库自己写「开启时刻」（关了再开会刷新，不靠人记得改）；关掉就清空
create or replace function public.telephony_set_analysis_enabled_at() returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.analysis_enabled is true and (tg_op = 'INSERT' or old.analysis_enabled is distinct from true) then
    new.analysis_enabled_at := now();
  elsif new.analysis_enabled is not true then
    new.analysis_enabled_at := null;
  end if;
  return new;
end $$;
create trigger telephony_connections_analysis_enabled_at
  before insert or update on public.telephony_connections
  for each row execute function public.telephony_set_analysis_enabled_at();
alter table public.telephony_connections add constraint telephony_connections_analysis_enabled_at_check
  check (analysis_enabled = false or analysis_enabled_at is not null);

alter table public.telephony_calls add column if not exists recording_storage_path text;
alter table public.telephony_calls add column if not exists recording_attempts int not null default 0;
alter table public.telephony_calls add column if not exists transcript_attempts int not null default 0;
alter table public.telephony_calls add column if not exists analysis_attempts int not null default 0;
alter table public.telephony_calls add column if not exists analysis_error text;

create table public.telephony_transcripts (
  call_id uuid primary key references public.telephony_calls(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  -- 通话正文（客人的话）：只有 service_role 能读，不进日志、不回给任何接口
  body text not null,
  model text not null,
  created_at timestamptz not null default now()
);

create table public.telephony_call_analyses (
  id uuid primary key default gen_random_uuid(),
  call_id uuid not null references public.telephony_calls(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  schema_version int not null,
  model text not null,
  summary text not null,
  language text,
  -- 每条事实都带原话；原话在转写里找不到的已被丢弃
  facts jsonb not null default '[]'::jsonb,
  dropped_facts int not null default 0,
  -- 只有人复核后才算数；pending_review 的内容不得当事实用、不得进学习样本
  review_status text not null default 'pending_review' check (review_status in ('pending_review', 'confirmed', 'rejected')),
  reviewed_by text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (call_id, schema_version)
);
create index telephony_call_analyses_review_idx on public.telephony_call_analyses (client_id, review_status);

alter table public.telephony_transcripts enable row level security;
alter table public.telephony_call_analyses enable row level security;
create policy telephony_transcripts_service_role on public.telephony_transcripts for all to service_role using (true) with check (true);
create policy telephony_call_analyses_service_role on public.telephony_call_analyses for all to service_role using (true) with check (true);
revoke all on public.telephony_transcripts from anon, authenticated;
revoke all on public.telephony_call_analyses from anon, authenticated;

-- 给触点打「有一份待复核分析」的标记：数据库里原子合并，避免读后写互相覆盖（其他更新同一条触点的代码并发时）
create or replace function public.telephony_mark_touchpoint(p_touchpoint_id uuid, p_client_id uuid, p_analysis_id uuid)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.contact_touchpoints
     set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('call_analysis_id', p_analysis_id::text, 'call_analysis_review', 'pending_review')
   where id = p_touchpoint_id and client_id = p_client_id;
$$;
revoke all on function public.telephony_mark_touchpoint(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.telephony_mark_touchpoint(uuid, uuid, uuid) to service_role;
