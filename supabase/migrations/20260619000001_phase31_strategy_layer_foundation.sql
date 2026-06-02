-- ============================================================================
-- Phase 31 M1: Strategy Layer Foundation
-- ============================================================================
-- 建立 Goal → Initiative → Action 三层骨架。
-- Action 层是现有 execution_items，只加 initiative_id 字段（向后兼容）。
--
-- 关键设计：
--   • 一个客户一次只有一个 active Goal（DB 约束）
--   • Initiative 类型按"工作流目的"切（demand_gen/conversion/trust 等 6 类）
--   • Initiative 分 terminal/supporting 两档，Goal verdict 只由 terminal 决定
--   • supports_initiative_id 让 supporting Initiative 指向它服务的 terminal
--   • 老 actions 自动归到每客户的 "Unassigned Backlog" Initiative（不破坏数据）
-- ============================================================================

-- ─── Enum 类型定义 ─────────────────────────────────────────────────────────

-- Goal 意图（3 种 + awareness sub-types 在 awareness_subtype 字段）
do $$ begin
  create type goal_intent as enum ('acquisition', 'sales', 'awareness');
exception when duplicate_object then null; end $$;

-- awareness intent 的细分子类型
do $$ begin
  create type awareness_subtype as enum (
    'new_market',           -- 新品牌进入新市场（如中国车企进 NZ）
    'event_campaign',       -- 活动推广（如 NZ 中国商品博览会）
    'geographic_expansion', -- 地理扩张（如 CTS 从基督城拓 Auckland）
    'reputation_recovery'   -- 口碑修复（占位）
  );
exception when duplicate_object then null; end $$;

-- Goal 状态
do $$ begin
  create type goal_status as enum ('draft', 'active', 'expired', 'archived');
exception when duplicate_object then null; end $$;

-- Goal verdict（90 天后归因结果）
do $$ begin
  create type goal_verdict as enum ('confirmed', 'partial', 'reversed', 'inconclusive');
exception when duplicate_object then null; end $$;

-- Initiative 类型（按"工作流目的"切，不按 6 维度切）
do $$ begin
  create type initiative_type as enum (
    'demand_generation',    -- 需求生成（SEO+Social+Ads+AIVis 跨维度）
    'conversion_optimization', -- 转化优化（Landing+Retargeting+Trust）
    'trust_building',       -- 信任建设（Reputation+UGC+PR）
    'competitive_defense',  -- 竞争防御（喂 Phase 30 baseline 对照）
    'market_education',     -- 市场教育（车企/新品类适用）
    'content_asset_production', -- 内容资产生产（弹药库，supporting）
    'unassigned'            -- 老数据兜底 bucket
  );
exception when duplicate_object then null; end $$;

-- Initiative 档次（terminal 决定 Goal 输赢，supporting 服务 terminal）
do $$ begin
  create type initiative_tier as enum ('terminal', 'supporting');
exception when duplicate_object then null; end $$;

-- Initiative 战术姿态（FDE 填，4 选 1）
do $$ begin
  create type initiative_posture as enum ('offensive', 'defensive', 'fast', 'slow');
exception when duplicate_object then null; end $$;


-- ─── Goal 表 ───────────────────────────────────────────────────────────────

create table if not exists goals (
  id                  uuid primary key default gen_random_uuid(),
  client_id           uuid not null references clients(id) on delete cascade,

  -- 老板视角：意图 + 主指标
  intent              goal_intent not null,
  awareness_subtype   awareness_subtype,        -- 仅当 intent='awareness' 时填
  title               text not null,            -- 短标题，FDE 起名（如 "CTS 2026 Q3 Sales +50%"）

  -- 主指标（决定 verdict）
  primary_metric_key   text not null,           -- 'monthly_revenue' / 'leads_count' / 'brand_search_volume' 等
  primary_metric_label text not null,           -- 给 FDE 看的中英文标签
  primary_metric_unit  text,                    -- 'NZD' / 'count' / 'searches/mo' 等
  baseline_value       numeric not null,        -- 起跑线（FDE 填）
  target_value         numeric not null,        -- 目标值（FDE 填）

  -- 辅指标（看趋势，不参与 verdict）
  supporting_metrics   jsonb not null default '[]'::jsonb,
                       -- [{key, label, unit, baseline, target?}]

  -- 时间与预算
  period_start         date not null,
  period_end           date not null,           -- acquisition/sales 90 天；awareness 倒计时
  budget_amount        numeric,                 -- 预算金额（可空 — 有些客户不公开）
  budget_currency      text default 'AUD',      -- AUD/NZD

  -- 状态与归因
  status               goal_status not null default 'draft',
  verdict              goal_verdict,            -- 到期后由 attribution job 写
  verdict_at           timestamptz,
  verdict_summary      text,                    -- 文字归因摘要（90 天后回填）

  -- FDE 战略 reasoning（创建 Goal 时必填）
  fde_reasoning        text,                    -- "客户想做什么 / 为什么定这个目标"
  is_beta              boolean not null default true,  -- Phase 31 Beta 标记，UI 显示 Beta 角标

  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  created_by           uuid                     -- 谁创建的（FDE user_id，未来挂 auth）
);

-- 索引
create index if not exists idx_goals_client_status on goals(client_id, status);
create index if not exists idx_goals_active_per_client on goals(client_id) where status = 'active';
create index if not exists idx_goals_period_end on goals(period_end) where status = 'active';

-- 一个客户同时只能有一个 active Goal
create unique index if not exists uniq_one_active_goal_per_client
  on goals(client_id) where status = 'active';


-- ─── Initiative 表 ─────────────────────────────────────────────────────────

create table if not exists initiatives (
  id                       uuid primary key default gen_random_uuid(),
  goal_id                  uuid not null references goals(id) on delete cascade,
  client_id                uuid not null references clients(id) on delete cascade,

  -- 战略属性
  initiative_type          initiative_type not null,
  tier                     initiative_tier not null,
                           -- demand_gen/conversion/trust/defense/education → terminal
                           -- content_asset_production → supporting
                           -- unassigned → supporting (默认，待 FDE 重新归类)
  title                    text not null,
  posture                  initiative_posture,         -- FDE 填，unassigned 可空

  -- 预算分配
  budget_percent           numeric check (budget_percent >= 0 and budget_percent <= 100),
                           -- 占 Goal 总预算的 %
  budget_amount            numeric,                    -- 衍生自 goal.budget * pct/100，存一份方便查询

  -- 战略假设（FDE 必填核心字段，AI 可润色）
  hypothesis               text,                       -- "为什么押这一条" — 90 天后归因看是否被验证
  hypothesis_polished_by_ai boolean not null default false,
                           -- 标记是否过 AI 润色，便于日后评估 AI 价值

  -- Supporting 关系：Supporting Initiative 必须指向一个 Terminal
  supports_initiative_id   uuid references initiatives(id) on delete set null,

  -- 状态与排序
  is_archived              boolean not null default false,
  sort_order               int not null default 0,

  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create index if not exists idx_initiatives_goal on initiatives(goal_id, sort_order);
create index if not exists idx_initiatives_client on initiatives(client_id) where not is_archived;
create index if not exists idx_initiatives_supports on initiatives(supports_initiative_id);

-- 业务规则：supporting initiative 必须指向 terminal
-- （DB 层不强约束，应用层校验 + 测试覆盖；强约束会让"先建 supporting 后绑 terminal"很难）

-- 同一 Goal 下 budget_percent 总和检查由应用层做（DB 不约束，因为 unassigned bucket 0% 也允许）


-- ─── execution_items 加 initiative_id ─────────────────────────────────────

alter table execution_items
  add column if not exists initiative_id uuid references initiatives(id) on delete set null;

create index if not exists idx_execution_items_initiative on execution_items(initiative_id);


-- ─── updated_at 触发器 ────────────────────────────────────────────────────

create or replace function set_goals_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

create trigger goals_updated_at
  before update on goals
  for each row execute function set_goals_updated_at();

create or replace function set_initiatives_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

create trigger initiatives_updated_at
  before update on initiatives
  for each row execute function set_initiatives_updated_at();


-- ─── RLS（service role full access；Phase 31 暂不区分 client viewer 权限）────

alter table goals enable row level security;
create policy "Service role full access" on goals
  for all using (true) with check (true);

alter table initiatives enable row level security;
create policy "Service role full access" on initiatives
  for all using (true) with check (true);


-- ─── 老数据兼容：每客户建一个 "Unassigned Backlog" Goal + Initiative ──────
--
-- 策略：
--   1. 给每个有 execution_items 的客户建一个 status='draft' 的 placeholder Goal
--      （title='[Migration] Unassigned Backlog' 标识，FDE 可后续删除或重组）
--   2. 给该 Goal 建一个 type='unassigned' Initiative
--   3. 把该客户所有未归属的 execution_items 的 initiative_id 指向这个 Initiative
--
-- 这样：
--   • 老 actions 不丢
--   • 不破坏现有功能（initiative_id 是可空字段）
--   • FDE 上线时看到 backlog，可以选择性迁移到真实 Goal
-- ────────────────────────────────────────────────────────────────────────

do $$
declare
  c record;
  new_goal_id uuid;
  new_initiative_id uuid;
begin
  for c in
    select distinct client_id from execution_items where initiative_id is null
  loop
    insert into goals (
      client_id, intent, title,
      primary_metric_key, primary_metric_label, primary_metric_unit,
      baseline_value, target_value,
      period_start, period_end,
      status, is_beta, fde_reasoning
    ) values (
      c.client_id, 'acquisition',
      '[Migration] Unassigned Backlog',
      'placeholder', 'Migration placeholder', 'count',
      0, 0,
      current_date, current_date + interval '365 days',
      'draft', true,
      'Auto-created by Phase 31 M1 migration. FDE: please review existing actions and migrate to a real Goal.'
    ) returning id into new_goal_id;

    insert into initiatives (
      goal_id, client_id, initiative_type, tier, title,
      hypothesis, sort_order
    ) values (
      new_goal_id, c.client_id, 'unassigned', 'supporting',
      'Unassigned Backlog',
      'Legacy actions awaiting FDE re-classification into Goal-driven Initiatives.',
      999
    ) returning id into new_initiative_id;

    update execution_items
      set initiative_id = new_initiative_id
      where client_id = c.client_id and initiative_id is null;
  end loop;
end $$;
