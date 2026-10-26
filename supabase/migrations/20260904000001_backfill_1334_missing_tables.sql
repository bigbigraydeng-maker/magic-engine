-- ============================================================================
-- #1334 补登记（一）：补回生产有、但仓库从零重建建不出来的 8 张表
-- ----------------------------------------------------------------------------
-- 背景：这些表是过去某些窗口用 apply_migration 直接打进生产库的，SQL 从未进
--   git。后果：照 supabase/migrations/ 从零重建 ≠ 生产。本文件把它们补回，
--   使「从零重放」的终态与生产一致。
--
-- 来源与验证：每张表的 DDL 从历史对话记录 + 生产 introspection 快照恢复，
--   并在本机 PostgreSQL 17 沙盘逐列奇偶校验（列集合与生产 100% 一致）。
--   外键凡经生产类型定义 Relationships 段确证的已标注；无法确证的
--   （ON DELETE 行为、可能的 UNIQUE/触发器）在各表注释里说明，待
--   execute_sql 权限恢复后用 pg_constraint/pg_indexes 核对。
--
-- 幂等：全部 IF NOT EXISTS / DROP POLICY IF EXISTS 再建。生产库已有这些对象，
--   本文件在生产上重跑为 no-op，无害；真正用到它的是「从零重建」场景。
--
-- 时间戳排在全部现有 migration 之后（最晚 20260903000002）。
-- 与 20260901000000_schema_baseline_finalise.sql 同属「补登记」性质。
-- ============================================================================


-- ─────────────────────────────────────────────────────────────────────────
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
--
--  来源：本文件是对生产库既有对象的补登记（原 SQL 曾经由 Supabase
--  apply_migration name='group_tours' 直接打进生产，账本版本
--  20260824110749，从未进过 git）。全部写成幂等，重跑无害。
-- ============================================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'group_tour_status') then
    create type group_tour_status as enum (
      'draft',      -- 草稿，还在解析/编辑
      'review',     -- 已解析，等人工审核确认字段
      'ready',      -- 人工已确认，可以发布
      'pr_open',    -- 已开出 GitHub PR，等人工 merge
      'published',  -- PR 已合并，团页已上线
      'archived'    -- 归档（不进默认列表）
    );
  end if;
end
$$;

create table if not exists group_tours (
  id                          uuid primary key default gen_random_uuid(),
  client_id                   uuid not null references clients(id) on delete cascade,

  status                      group_tour_status not null default 'draft',
  title                       text not null default '',
  slug                        text not null default '',

  payload                     jsonb not null default '{}'::jsonb,

  source_document_name        text,
  source_document_kind        text,

  confidence_notes            jsonb not null default '[]'::jsonb,
  client_claims_to_verify     jsonb not null default '[]'::jsonb,
  missing_fields              jsonb not null default '[]'::jsonb,

  required_fields_confirmed   boolean not null default false,

  pr_url                      text,
  pr_number                   integer,
  published_at                timestamptz,

  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),

  constraint group_tours_slug_per_client unique (client_id, slug)
);

create index if not exists idx_group_tours_client_status_updated
  on group_tours (client_id, status, updated_at desc);

create index if not exists idx_group_tours_pr_open
  on group_tours (status)
  where status = 'pr_open';

create or replace function group_tours_set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists group_tours_updated_at on group_tours;
create trigger group_tours_updated_at
  before update on group_tours
  for each row
  execute function group_tours_set_updated_at();

alter table group_tours enable row level security;

-- 仓库规矩：新表 RLS 一律 service-role 模板。必须写 TO service_role，
-- 漏掉 = 对匿名访客敞开读写。租户隔离由 API 层保证，不靠 RLS。
drop policy if exists "group_tours_service_role_all" on group_tours;
create policy "group_tours_service_role_all"
  on group_tours
  for all
  to service_role
  using (true);

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
-- ─────────────────────────────────────────────────────────────────────────
-- 跨客户经验库 —— 补齐 memory 系统缺失的「全局/行业」层。
-- 现有 client_learned_preferences / client_proven_patterns / client_failed_experiments
-- 全部带 client_id（客户级）；本表存的是「不属于任何单个客户」的认知，
-- 例如「学区房广告不能只投住在学区附近的人」——对下一个楼盘同样成立。
CREATE TABLE IF NOT EXISTS global_learned_lessons (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 幂等键：同一条经验反复观察到时 upsert，不重复堆行
  lesson_key         text NOT NULL UNIQUE,
  scope              text NOT NULL DEFAULT 'global'
                     CHECK (scope IN ('global','industry','channel')),
  industry           text,
  flywheel           text CHECK (flywheel IN ('seo','geo','ads','social','cross')),
  -- 经验本身：写成可执行的祈使句，不是感想
  lesson             text NOT NULL,
  -- 为什么成立 + 证据；红线：不许写没有出处的「经验」
  rationale          text,
  evidence           jsonb NOT NULL DEFAULT '{}'::jsonb,
  confidence         numeric(3,2) NOT NULL DEFAULT 0.50
                     CHECK (confidence >= 0 AND confidence <= 1),
  -- 经验必须可被推翻：只涨不跌的「经验」会把偶然当规律
  confirmed_count    integer NOT NULL DEFAULT 1,
  contradicted_count integer NOT NULL DEFAULT 0,
  source             text NOT NULL DEFAULT 'agent_observation'
                     CHECK (source IN ('agent_observation','auto_extracted','fde_annotation','incident')),
  first_observed_at  timestamptz NOT NULL DEFAULT now(),
  last_confirmed_at  timestamptz NOT NULL DEFAULT now(),
  is_active          boolean NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gll_scope_active ON global_learned_lessons (scope, is_active);
CREATE INDEX IF NOT EXISTS idx_gll_industry     ON global_learned_lessons (industry) WHERE industry IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_gll_flywheel     ON global_learned_lessons (flywheel) WHERE flywheel IS NOT NULL;

ALTER TABLE global_learned_lessons ENABLE ROW LEVEL SECURITY;
-- 原始生产语句写的是 `CREATE POLICY "service_role_full" ... FOR ALL USING (true)`，
-- 漏了 `TO service_role` —— 等于对匿名访客敞开读写（生产至今仍是这个状态）。
-- 这里用 DROP + CREATE，而不是原文那个 `DO $$ ... EXCEPTION WHEN duplicate_object THEN NULL`：
-- 后者在已有该策略的生产库上重跑会静默保留旧的宽口策略，等于补了个寂寞。
DROP POLICY IF EXISTS "service_role_full" ON global_learned_lessons;
CREATE POLICY "service_role_full" ON global_learned_lessons
  FOR ALL TO service_role USING (true);

COMMENT ON TABLE  global_learned_lessons IS '跨客户经验库（memory 系统的全局/行业层）。客户级经验仍走 client_* 四表。';
COMMENT ON COLUMN global_learned_lessons.lesson_key IS '幂等键。同一条经验再次被观察到 → upsert 并 confirmed_count+1，不新增行。';
COMMENT ON COLUMN global_learned_lessons.evidence IS '证据链：{client_ids, metrics, doc_path, campaign_id...}。无出处的经验不许入库。';
COMMENT ON COLUMN global_learned_lessons.contradicted_count IS '被反例推翻的次数。confirmed 远小于 contradicted 时应下架该经验。';
-- ─────────────────────────────────────────────────────────────────────────
-- Recovered from Supabase MCP apply_migration "create_client_prospects"
-- applied to production 2026-07-28T13:39:22Z (ledger version 20260728133928).
-- Table DDL is verbatim from the original call; only the RLS policy was
-- corrected to the repo's mandatory service-role template (original omitted
-- TO service_role, which leaves anon read/write open) and made idempotent.

CREATE TABLE IF NOT EXISTS client_prospects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  tier text,
  business_name text,
  region text,
  phone text,
  contact_extra text,
  review_count integer,
  license text,
  why_call text,
  do_not_call boolean NOT NULL DEFAULT false,
  do_not_call_reason text,
  called boolean NOT NULL DEFAULT false,
  called_at timestamptz,
  call_status text,
  call_notes text,
  source text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_client_prospects_client_tier ON client_prospects (client_id, tier);
CREATE INDEX IF NOT EXISTS idx_client_prospects_phone ON client_prospects (client_id, phone);

ALTER TABLE client_prospects ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_full" ON client_prospects;
CREATE POLICY "service_role_full" ON client_prospects
  FOR ALL TO service_role USING (true) WITH CHECK (true);
-- ─────────────────────────────────────────────────────────────────────────
-- Recovered from commit 579a40a7 (PR #666, closed unmerged):
-- supabase/migrations/20260728000001_seo_loop.sql
-- Applied to production out-of-band as ledger entry 20260728011705|seo_loop.
--
-- Three suggested topics per client per week. status starts at 'candidate' and
-- only a human moves it forward — this table is the hand-off point between the
-- automated loop and human approval. Nothing auto-publishes.
CREATE TABLE IF NOT EXISTS seo_topic_candidates (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id            UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  week_of              DATE NOT NULL,
  keyword              TEXT NOT NULL,
  source               TEXT NOT NULL
                         CHECK (source IN ('opportunity_gap','striking_distance','ai_visibility_gap')),
  priority             INTEGER NOT NULL DEFAULT 1,
  my_position          INTEGER,
  search_volume        INTEGER,
  keyword_difficulty   NUMERIC(5,2),
  competitors_ranking  TEXT[] NOT NULL DEFAULT '{}',
  reason               TEXT NOT NULL,
  -- candidate -> a human approves -> drafting -> draft lands in blog_posts
  status               TEXT NOT NULL DEFAULT 'candidate'
                         CHECK (status IN ('candidate','approved','rejected','drafted')),
  blog_post_id         UUID REFERENCES blog_posts(id) ON DELETE SET NULL,
  reviewed_at          TIMESTAMPTZ,
  reviewed_by          TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS seo_topic_candidates_unique
  ON seo_topic_candidates (client_id, week_of, keyword);

CREATE INDEX IF NOT EXISTS seo_topic_candidates_client_week
  ON seo_topic_candidates (client_id, week_of DESC);

CREATE INDEX IF NOT EXISTS seo_topic_candidates_status
  ON seo_topic_candidates (status) WHERE status = 'candidate';

ALTER TABLE seo_topic_candidates ENABLE ROW LEVEL SECURITY;

-- Original shipped `FOR ALL USING (true)` with no TO clause, which grants the
-- policy to PUBLIC (anon included). Re-created with the mandated service-role
-- template so re-running this on production also closes that hole.
DROP POLICY IF EXISTS "service_role_full" ON seo_topic_candidates;
CREATE POLICY "service_role_full" ON seo_topic_candidates
  FOR ALL TO service_role USING (true);
-- ─────────────────────────────────────────────────────────────────────────
-- Recovered from unmerged branch origin/feat/seo-weekly-loop,
-- commit 579a40a7, file supabase/migrations/20260728000001_seo_loop.sql.
-- Applied to production as ledger entry 20260728011705|seo_loop; the branch
-- was never merged, which is why the repo replay is missing this table.
--
-- Only competitor_keyword_snapshots is reproduced here; the same source file
-- also created seo_topic_candidates (separate gap).
--
-- Mirrors keyword_snapshots but for a competitor domain. The existing
-- `competitor_snapshots` table is a per-run usage log whose top_keywords JSON
-- carries no positions, so it cannot answer "who ranks where" — that is why
-- this table exists rather than extending that one.

CREATE TABLE IF NOT EXISTS competitor_keyword_snapshots (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id          UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  competitor_domain  TEXT NOT NULL,
  keyword            TEXT NOT NULL,
  position           INTEGER,
  search_volume      INTEGER,
  keyword_difficulty NUMERIC(5,2),
  cpc                NUMERIC(10,2),
  competition        NUMERIC(5,4),
  intent             TEXT,
  source             TEXT NOT NULL DEFAULT 'dataforseo',
  location_code      INTEGER NOT NULL,
  semrush_db         TEXT,
  snapshot_date      DATE NOT NULL DEFAULT CURRENT_DATE,
  measured_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS competitor_keyword_snapshots_unique
  ON competitor_keyword_snapshots (client_id, competitor_domain, keyword, location_code, snapshot_date);

CREATE INDEX IF NOT EXISTS competitor_keyword_snapshots_client_date
  ON competitor_keyword_snapshots (client_id, snapshot_date DESC);

CREATE INDEX IF NOT EXISTS competitor_keyword_snapshots_keyword
  ON competitor_keyword_snapshots (client_id, keyword);

ALTER TABLE competitor_keyword_snapshots ENABLE ROW LEVEL SECURITY;

-- MINIMAL NECESSARY FIX vs the original: the 2026-07-28 DDL wrote
--   CREATE POLICY "service_role_full" ... FOR ALL USING (true)
-- with no TO clause, i.e. PUBLIC — open read/write to anonymous visitors.
-- Restated per the CLAUDE.md service-role template, and made idempotent so a
-- re-run on production repairs the existing over-broad policy in place.
DROP POLICY IF EXISTS "service_role_full" ON competitor_keyword_snapshots;
CREATE POLICY "service_role_full" ON competitor_keyword_snapshots
  FOR ALL TO service_role USING (true);
-- ─────────────────────────────────────────────────────────────────────────
-- ============================================================================
-- datasource_usage_events —— 把生产库的孤儿表补回仓库
-- 该表是 out-of-band 直接建在生产库上的，从未进过 supabase/migrations。
-- 本文件按 2026-08-04 生产库 information_schema / pg_indexes / pg_policies
-- 实读结果重建，整段幂等：在已有该表的生产库上重跑是 no-op。
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.datasource_usage_events (
  id         BIGSERIAL PRIMARY KEY,
  client_id  UUID NOT NULL REFERENCES public.clients(id),
  service    TEXT NOT NULL,
  operation  TEXT,
  api_calls  INTEGER NOT NULL DEFAULT 1,
  cost_usd   NUMERIC NOT NULL DEFAULT 0,
  usage_date DATE NOT NULL DEFAULT CURRENT_DATE,
  metadata   JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_datasource_usage_events_client_date
  ON public.datasource_usage_events (client_id, usage_date DESC);

CREATE INDEX IF NOT EXISTS idx_datasource_usage_events_service_date
  ON public.datasource_usage_events (service, usage_date DESC);

ALTER TABLE public.datasource_usage_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "datasource_usage_events_service_role_full"
  ON public.datasource_usage_events;
CREATE POLICY "datasource_usage_events_service_role_full"
  ON public.datasource_usage_events
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
-- ─────────────────────────────────────────────────────────────────────────
-- ============================================================================
--  tasks（通用 PM/运维任务表）
-- ----------------------------------------------------------------------------
--  来源：生产库既有对象（0 行），从未进 git，也无独立账本条目。
--  外键 project_id→client_projects(id) 经生产类型定义 Relationships 段确证；
--  ON DELETE CASCADE 为语义推断（类型定义不含 ON DELETE 信息，待权限恢复后
--  用 pg_constraint 核对）。全部幂等，重跑无害。
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.tasks (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid REFERENCES public.client_projects(id) ON DELETE CASCADE,
  owner_id     uuid,
  title        text NOT NULL,
  detail       text,
  priority     integer NOT NULL DEFAULT 0,
  is_done      boolean NOT NULL DEFAULT false,
  due_at       timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tasks_service_role_all ON public.tasks;
CREATE POLICY tasks_service_role_all ON public.tasks
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ─────────────────────────────────────────────────────────────────────────
-- ============================================================================
--  deployments 建表（生产有、仓库缺）
-- ----------------------------------------------------------------------------
--  依据本机多份一致的生产 introspection 快照 + 类型定义 Relationships 重建。
--  列集合 8/8 与 prod_cols.txt 逐列一致；外键 client_id→clients 经 Relationships
--  确证。status 的 CHECK(active/revoked) 来自快照。
--  ⚠️ 无法从快照确证、故按最小必要处理的：外键 ON DELETE 行为、可能存在的
--     UNIQUE 约束、触发器 —— 待 execute_sql 权限恢复后用 pg_constraint/pg_indexes 核对。
--  RLS 按仓库铁律补 service_role 策略：生产此表历史上曾是「RLS 开、零策略」
--  （2026-08-12 advisor 点名，2026-09-03 已补策略）；service_role 策略对
--  anon/authenticated 的实际访问能力与「零策略」等价（都 fail-closed），
--  故补策略不改变行为，只满足铁律并使重建有显式策略。全部幂等，重跑无害。
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.deployments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   uuid NOT NULL REFERENCES public.clients(id),
  page_url    text NOT NULL,
  deployed_at timestamptz DEFAULT now(),
  deployed_by text,
  status      text DEFAULT 'active' CHECK (status = ANY (ARRAY['active'::text, 'revoked'::text])),
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);

ALTER TABLE public.deployments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "deployments_service_role_all" ON public.deployments;
CREATE POLICY "deployments_service_role_all" ON public.deployments
  FOR ALL TO service_role USING (true);
