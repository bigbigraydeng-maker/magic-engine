-- ============================================================================
--  Group Tours（团管理工具 · 首个落地客户 CTS Tours NZ）
-- ----------------------------------------------------------------------------
--  一行 = 一个团（大众获客用的团期产品，区别于 tailor_made_itineraries
--  那种发给「客户的客户」的一对一定制行程报价单）。
--
--  设计对齐 tailor_made_itineraries（20260728115948），
--  见 docs/clients/ 和 CLAUDE.md 平台化原则：字段命名平台通用，
--  发布时才映射成客户网站自己的数据形状（如 CTS 的 Tour 接口）。
--  日期：2026-08-24
-- ============================================================================

create type group_tour_status as enum (
  'draft',      -- 草稿，还在解析/编辑
  'review',     -- 已解析，等人工审核确认字段
  'ready',      -- 人工已确认，可以发布
  'pr_open',    -- 已开出 GitHub PR，等人工 merge
  'published',  -- PR 已合并，团页已上线
  'archived'    -- 归档（不进默认列表）
);

create table group_tours (
  id                          uuid primary key default gen_random_uuid(),
  client_id                   uuid not null references clients(id) on delete cascade,

  status                      group_tour_status not null default 'draft',
  title                       text not null default '',
  slug                        text not null default '',

  -- 结构化团数据：itinerary / price / departures / inclusions / exclusions /
  -- highlights / faqs / heroImage / gallery 等，字段命名平台通用，
  -- 发布时才映射成目标网站自己的字段形状（见 src/lib/group-tours/publisher.ts）
  payload                     jsonb not null default '{}'::jsonb,

  source_document_name        text,
  source_document_kind        text,  -- docx | pdf | text

  confidence_notes            jsonb not null default '[]'::jsonb,
  client_claims_to_verify     jsonb not null default '[]'::jsonb,
  missing_fields              jsonb not null default '[]'::jsonb,

  -- 后端强制发布闸用的字段，不是纯前端约定 —— 绕开 UI 直调 API 也拦得住。
  -- 见 src/lib/group-tours/publisher.ts 的发布前置校验。
  required_fields_confirmed   boolean not null default false,

  pr_url                      text,
  pr_number                   integer,
  published_at                timestamptz,

  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 索引
-- ----------------------------------------------------------------------------

-- 只约束已分配的（非空）slug 唯一——建团接口每次都以 slug='' 起手，一个客户
-- 名下允许同时存在多条未命名草稿，不然只要有一条空草稿卡在那儿，下一次点
-- "新增团" 就会撞唯一约束返回 500（魏征 finding 5）。
create unique index group_tours_slug_per_client
  on group_tours (client_id, slug)
  where slug <> '';

create index idx_group_tours_client_status_updated
  on group_tours (client_id, status, updated_at desc);

-- pr-sync cron 巡检用：按状态='pr_open'扫描
create index idx_group_tours_pr_open
  on group_tours (status)
  where status = 'pr_open';

-- ----------------------------------------------------------------------------
-- updated_at 自动更新
-- ----------------------------------------------------------------------------

create or replace function group_tours_set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger group_tours_updated_at
  before update on group_tours
  for each row
  execute function group_tours_set_updated_at();

-- ----------------------------------------------------------------------------
-- RLS
-- ----------------------------------------------------------------------------
-- 只经服务端访问；显式建 service_role policy，不依赖"不建 policy = 隐式绕过"
-- 这种隐式行为（CLAUDE.md 规则7：新表 migration 的 RLS 一律 service-role 模板）。
--
-- ⚠️ 租户隔离由 API 层的 requireDashboardClientAccess(clientId) 保证，
--    不是靠 RLS。所有 store 查询都必须带 .eq('client_id', clientId)。
alter table group_tours enable row level security;

create policy "service_role_full"
  on group_tours for all to service_role
  using (true) with check (true);

-- ----------------------------------------------------------------------------
-- 注释
-- ----------------------------------------------------------------------------

comment on table group_tours is
  '团管理工具：客户（如 CTS）对外销售的团期产品草稿/审核/发布状态机';
comment on column group_tours.slug is
  '发布用 slug，在 client_id 内唯一；映射到目标网站的 Tour.slug';
comment on column group_tours.payload is
  '完整团数据 JSON，平台通用字段命名，发布时映射成目标网站的数据形状';
comment on column group_tours.required_fields_confirmed is
  '人工已确认关键字段（价格/团期/行程）无误 —— 后端发布闸校验用，非前端状态';
comment on column group_tours.confidence_notes is
  'AI 解析时的存疑点，供人工审核';
comment on column group_tours.client_claims_to_verify is
  '客户营销材料与行程文档冲突处，供人工核实（CLAUDE.md 规则8）';
