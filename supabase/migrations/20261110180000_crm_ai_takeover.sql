-- ════════════════════════════════════════════════════════════════════════════
-- CRM「AI 接管」标签（刀 A）
-- 设计稿：docs/specs/2026-11-08-crm-ai-takeover-and-dnc-reengage-design-v0.md §4
--
-- contact_automation_events  只追加的记录：哪位客人哪天被谁「交给 AI 跟进」/「收回人工」。真相看这张表。
-- contacts.ai_takeover_since 镜像列：空 = 不在接管中。只为今日名单和以后的选人读得快，由写入方按记录表重算。
--
-- 跟阶段完全分开：阶段照旧走 contact_stage_events，这里不碰阶段。
-- ════════════════════════════════════════════════════════════════════════════

create table public.contact_automation_events (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id),
  contact_id uuid not null references public.contacts(id) on delete cascade,
  kind text not null check (kind in ('ai_takeover_on', 'ai_takeover_off')),
  -- 员工邮箱，或 system:* （第一版只有员工点按钮）
  actor text not null check (char_length(actor) between 1 and 320),
  reason text check (reason is null or char_length(reason) <= 500),
  -- 发的是哪一版目录（只在 ai_takeover_on 时有）
  catalog_version text check (catalog_version is null or char_length(catalog_version) <= 40),
  -- 防双击：同一次点击只记一条
  source_ref text check (source_ref is null or char_length(source_ref) between 1 and 200),
  created_at timestamptz not null default now(),
  -- 一个普通 UNIQUE 约束而不是带 WHERE 的部分索引：空值本来就互不冲突（效果同 where source_ref is not null），
  -- 而接口的 upsert(onConflict) 只认得普通约束，部分索引会让「防双击」那一步直接报错。
  constraint contact_automation_events_source_ref_key unique (client_id, source_ref)
);

create index contact_automation_events_contact_idx
  on public.contact_automation_events (client_id, contact_id, created_at desc);

comment on table public.contact_automation_events is
  'CRM「AI 接管」只追加记录（ai_takeover_on / ai_takeover_off）。最新一条说了算。设计稿 2026-11-08 §4。';

alter table public.contacts
  add column ai_takeover_since timestamptz null;

comment on column public.contacts.ai_takeover_since is
  '「AI 接管」镜像列：空 = 不在接管中。真相看 contact_automation_events（最新一条说了算）。';

-- RLS：service-role 模板（必须带 TO service_role，漏掉 = 对匿名访客敞开读写）
alter table public.contact_automation_events enable row level security;

create policy contact_automation_events_service_role
  on public.contact_automation_events
  for all
  to service_role
  using (true)
  with check (true);
