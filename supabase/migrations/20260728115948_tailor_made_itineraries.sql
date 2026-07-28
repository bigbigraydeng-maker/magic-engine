-- ============================================================================
--  Tailor-made 行程单（客户经营工具 · 首个落地客户 CTS Tours NZ）
-- ----------------------------------------------------------------------------
--  一行 = 客户发给「客户的客户」的一份定制行程报价单。
--  行程内容整体存 payload (jsonb)，schema 见
--    templates/tailor-made-itinerary/README.md
--  列表页要用的字段（客户名 / 标题 / 状态 / 报价号）提到列上，不必解 JSON。
--
--  多租户：client_id 外键接 clients。所有查询按 client_id 收敛，
--  报价编号在「每个客户内」唯一（不同客户各自从 0001 开始）。
--  日期：2026-07-28
-- ============================================================================

create type tailor_made_status as enum (
  'draft',      -- 草稿，顾问还在改
  'sent',       -- 已发给终端客户
  'confirmed',  -- 已确认成交
  'archived'    -- 归档（不进默认列表）
);

create table tailor_made_itineraries (
  id                uuid primary key default gen_random_uuid(),
  client_id         uuid not null references clients(id) on delete cascade,

  -- 列表页字段（与 payload 内同名字段由服务端写入时一并同步）
  quote_ref         text not null,
  end_client_name   text not null default '',   -- 「客户的客户」，即行程单的收件人
  trip_title        text not null default '',
  status            tailor_made_status not null default 'draft',

  payload           jsonb not null,

  consultant_name   text,
  consultant_email  text,
  sent_at           timestamptz,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  -- 报价编号在客户内唯一，不是全局唯一
  constraint tailor_made_itineraries_quote_ref_per_client unique (client_id, quote_ref)
);

-- ----------------------------------------------------------------------------
-- 索引
-- ----------------------------------------------------------------------------

-- 列表页默认视图：某客户下非归档，按最近修改倒序
create index idx_tailor_made_client_status_updated
  on tailor_made_itineraries (client_id, status, updated_at desc);

-- 按终端客户名找单（顾问最常见的检索方式）
create index idx_tailor_made_end_client_name
  on tailor_made_itineraries (client_id, lower(end_client_name));

-- ----------------------------------------------------------------------------
-- updated_at 自动更新
-- ----------------------------------------------------------------------------

create or replace function tailor_made_itineraries_set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger tailor_made_itineraries_updated_at
  before update on tailor_made_itineraries
  for each row
  execute function tailor_made_itineraries_set_updated_at();

-- ----------------------------------------------------------------------------
-- RLS
-- ----------------------------------------------------------------------------
-- 与库内既有表一致：只经服务端访问，service_role 自动绕过 RLS。
-- 启用 RLS 且不建 policy = 匿名 / authenticated 一律拒绝。
--
-- ⚠️ 租户隔离由 API 层的 requireDashboardClientAccess(clientId) 保证，
--    不是靠 RLS。所有 store 查询都必须带 .eq('client_id', clientId)。
alter table tailor_made_itineraries enable row level security;

-- ----------------------------------------------------------------------------
-- 注释
-- ----------------------------------------------------------------------------

comment on table tailor_made_itineraries is
  'Tailor-made 行程单：客户（如 CTS）发给其终端客户的定制行程报价单';
comment on column tailor_made_itineraries.client_id is
  'ME 客户（旅行社本身），非终端客户';
comment on column tailor_made_itineraries.end_client_name is
  '终端客户称呼，出现在行程单封面 Prepared for';
comment on column tailor_made_itineraries.quote_ref is
  '报价编号，对终端客户可见；在 client_id 内唯一';
comment on column tailor_made_itineraries.payload is
  '完整行程 JSON，schema 见 templates/tailor-made-itinerary/README.md';
comment on column tailor_made_itineraries.sent_at is
  '首次发送给终端客户的时间';
