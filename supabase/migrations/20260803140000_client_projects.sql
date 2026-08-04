-- 项目层：中介名下的楼盘（2026-08-03 PM 拍板）
--
-- PM 原话：「我们的客户就是 Roman Hu…楼盘销售都应该归属到 Agent 下面的，
-- 然后在这里我们为 agent 创立单独的楼盘 master brief、广告等策略。
-- 这两单都是我们对 Roman 负责，但是 invoice 是我们和楼盘开发商直接发。」
--
-- 为什么不是「一个楼盘一个客户档」：那会把**服务关系**和**资产隔离**混成一件事。
--   服务关系：我们只对中介一个人负责（报告、沟通、续费都是他）
--   资产隔离：Kiteroa 的实拍绝不能进 Parkhomes 的广告（两个开发商是竞品）
-- 拆成两层就都成立 —— 客户层管服务与账，项目层管资产与隔离。
--
-- 🔴 隔离是这张表存在的首要理由，不是「整理得好看」。素材隔离此前只按 client_id，
--    楼盘不是客户就拦不住跨楼盘串用。

create table if not exists public.client_projects (
  id uuid primary key default gen_random_uuid(),
  -- 谁的项目 = 中介客户。中介档删了，项目跟着走。
  client_id uuid not null references public.clients(id) on delete cascade,
  name text not null,
  status text not null default 'active',

  -- 开票对象 ≠ 服务对象：我们对中介负责，发票开给开发商。
  -- 混成一个字段就答不出「这单钱找谁要」。
  invoice_to_name text,
  invoice_to_contact text,
  invoice_to_email text,

  -- 楼盘自己的定位与卖点。不同楼盘的人群、价格带、卖点完全不同，
  -- 共用中介那一份 brief 出来的内容必然含糊。
  brief jsonb not null default '{}'::jsonb,
  factory_config jsonb not null default '{}'::jsonb,

  -- 并档溯源：这个项目是从哪个旧客户档降级来的。留着才查得回历史数据。
  merged_from_client_id uuid references public.clients(id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.client_projects
  drop constraint if exists client_projects_status_check;
alter table public.client_projects
  add constraint client_projects_status_check
  check (status in ('active', 'paused', 'completed', 'archived'));

create index if not exists idx_client_projects_client on public.client_projects(client_id);
-- 同一个中介名下不允许两个同名楼盘 —— 否则素材归属会靠人肉眼分辨
create unique index if not exists idx_client_projects_client_name
  on public.client_projects(client_id, lower(name));

alter table public.client_projects enable row level security;
drop policy if exists "Service role full access" on public.client_projects;
create policy "Service role full access" on public.client_projects
  for all using (true) with check (true);

comment on table public.client_projects is
  '中介名下的楼盘/项目。客户层管服务与账，项目层管资产与隔离。开票对象(开发商)与服务对象(中介)分开。';

-- ── 素材隔离下沉到项目 ────────────────────────────────────────────────────
-- 可空：非地产客户（CTS/Oztop）没有项目，素材直接挂客户，行为不变。
-- on delete set null：项目删了素材还在，不静默丢客户的东西。

alter table public.client_assets
  add column if not exists project_id uuid references public.client_projects(id) on delete set null;
alter table public.video_clips
  add column if not exists project_id uuid references public.client_projects(id) on delete set null;

create index if not exists idx_client_assets_project on public.client_assets(project_id)
  where project_id is not null;
create index if not exists idx_video_clips_project on public.video_clips(project_id)
  where project_id is not null;

comment on column public.client_assets.project_id is
  '归属楼盘。为空 = 属于客户本身（非地产客户皆如此）。有值时素材只能用于该楼盘，跨楼盘串用是红线。';
comment on column public.video_clips.project_id is
  '归属楼盘。为空 = 属于客户本身。有值时片段只能用于该楼盘 —— 竞品开发商之间绝不共用。';

-- 楼盘各有自己的 master brief（PM 明确要求）
alter table public.master_briefs
  add column if not exists project_id uuid references public.client_projects(id) on delete cascade;
create index if not exists idx_master_briefs_project on public.master_briefs(project_id)
  where project_id is not null;
