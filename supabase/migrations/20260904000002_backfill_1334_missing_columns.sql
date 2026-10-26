-- ============================================================================
-- #1334 补登记（二）：补回生产有、但仓库重建后缺的 37 列（分布在 8 张表）
-- ----------------------------------------------------------------------------
-- 来源与验证：同文件（一）。每列的类型/nullable 逐列对照生产类型定义；
--   带 CHECK 约束的列（如 outbound_prospects.discovery_report_status）已在沙盘
--   确认约束真的建出来（这是最容易被手抄吞掉的细节）。
--
-- 外键裁决：viral / prescriptions 的补列均为裸列（生产类型定义 Relationships
--   段证明这些列在生产无外键约束——不加，以免重建库多出生产没有的约束）。
--
-- 既有表加列不套 RLS 模板：这些表在生产已有 RLS + service_role 策略（或处于
--   RLS 开、零策略的 fail-closed 态），加列不触碰策略。
--
-- 幂等：全部 ADD COLUMN IF NOT EXISTS。生产重跑为 no-op。
-- ============================================================================


-- ─────────────────────────────────────────────────────────────────────────
-- 注意：原候选**没有错**，判定 CONFIRMED。下面这版只是把 P1 那处不对称防护补齐（多 2 行），
-- 在生产态和全新重放态与原版行为完全相同；只有在「列已存在但形状不对」的半漂移库上才有差别。
-- 已实测：连跑两遍 psql exit=0；列奇偶与 prod 29 列 zero diff；23514/23502/默认 pending 行为一致；
-- 半漂移库跑完 crawl_status 被修成 NOT NULL DEFAULT 'pending'。

-- client_site_pages: 补回生产库有、仓库建不出来的 8 列（schema drift 回填）
--
-- 背景：20260504000001_client_site_pages.sql 的 CREATE POLICY 引用了从未实现的 client_team，
-- 生产库这张表是另外手工建的，形状与仓库文件不同。因此 path / h1 / meta_description /
-- content_summary / geo_block_version / crawl_status / last_crawled_at / crawl_error
-- 这 8 列从未进过 git。
--
-- 每一项定义都来自生产库实测（information_schema.columns 的 is_nullable + column_default、
-- pg_get_constraintdef、pg_indexes，2026-08-17 转储），不是推断。全部幂等。

ALTER TABLE client_site_pages
  ADD COLUMN IF NOT EXISTS path              text,
  ADD COLUMN IF NOT EXISTS h1                text,
  ADD COLUMN IF NOT EXISTS meta_description  text,
  ADD COLUMN IF NOT EXISTS content_summary   text,
  ADD COLUMN IF NOT EXISTS geo_block_version text,
  ADD COLUMN IF NOT EXISTS crawl_status      text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS last_crawled_at   timestamptz,
  ADD COLUMN IF NOT EXISTS crawl_error       text;

-- path 在生产库是 NOT NULL 且无默认值。分两步（先加可空、再收紧）而不是直接
-- ADD COLUMN ... NOT NULL，是为了让这条在生产库（列已存在、已是 NOT NULL）上是无操作、
-- 在从零重放（表为空）上直接通过。故意不做 backfill：真有 NULL 行时宁可在这里报错停住，
-- 也不替客户数据编一个 path。
ALTER TABLE client_site_pages ALTER COLUMN path SET NOT NULL;

-- 同理收紧 crawl_status。ADD COLUMN IF NOT EXISTS 在列已存在时会跳过整条子句，
-- 连带把 NOT NULL 和 DEFAULT 一起静默丢掉；这两行保证无论列是新建还是早已存在，
-- 最终形状都等于生产实测值。生产态下两条都是无操作。
ALTER TABLE client_site_pages ALTER COLUMN crawl_status SET DEFAULT 'pending';
ALTER TABLE client_site_pages ALTER COLUMN crawl_status SET NOT NULL;

-- 生产实测约束 client_site_pages_crawl_status_check
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.client_site_pages'::regclass
      AND conname  = 'client_site_pages_crawl_status_check'
  ) THEN
    ALTER TABLE client_site_pages
      ADD CONSTRAINT client_site_pages_crawl_status_check
      CHECK (crawl_status = ANY (ARRAY['pending'::text, 'crawled'::text, 'failed'::text]));
  END IF;
END $$;

-- 生产实测索引 idx_client_site_pages_status
CREATE INDEX IF NOT EXISTS idx_client_site_pages_status
  ON client_site_pages USING btree (client_id, crawl_status);
-- ─────────────────────────────────────────────────────────────────────────
-- ============================================================================
--  prescriptions 补列（生产有、仓库重建后缺的 10 列）
-- ----------------------------------------------------------------------------
--  相关账本：20260513160619 prescriptions_discovery_source、
--            20260514064655 prescription_supplement_revision。
--  ⚠️ 外键裁决（依据生产类型定义 Relationships）：生产 prescriptions 外键只有
--     client_id→clients、goal_id→goals（均为已有列）。supersedes_id/
--     supplements_id/discovery_id 在生产是裸 uuid 列，无外键——故此处不加外键。
--  全部 ADD COLUMN IF NOT EXISTS，幂等，重跑无害。
-- ============================================================================

ALTER TABLE public.prescriptions
  ADD COLUMN IF NOT EXISTS discovery_id    uuid,
  ADD COLUMN IF NOT EXISTS supersedes_id   uuid,
  ADD COLUMN IF NOT EXISTS supplements_id  uuid,
  ADD COLUMN IF NOT EXISTS self_grade      text,
  ADD COLUMN IF NOT EXISTS benchmarks_used jsonb,
  ADD COLUMN IF NOT EXISTS agent_name      text,
  ADD COLUMN IF NOT EXISTS agent_version   text,
  ADD COLUMN IF NOT EXISTS generation_meta jsonb,
  ADD COLUMN IF NOT EXISTS progress_note   text,
  ADD COLUMN IF NOT EXISTS error_message   text;

-- ─────────────────────────────────────────────────────────────────────────
-- 爆款库补「分镜头配方」字段 [P21.J]
--
-- 为什么:库里已有 705 条爆款,却**没有一个结构数字** —— 无时长、无镜头数、
-- 无切点频率。存的全是 "fast cut" / "visual shock" 这类文字描述。
-- 后果:被问「单镜头应该几秒」时答不出来,而 shot-recipes.ts 里的 3.6 / 2.8 秒
-- 全是手写猜测。记了 705 条爆款,一条都没量过。
--
-- 存 jsonb 而不是拆成 8 个列:结构会演进(以后要加文字时间轴、音频节拍),
-- 每次演进都开 migration 不划算;而且这是分析产物,不做关系查询。
-- 需要按数字筛选时用表达式索引(见下方 median_shot_seconds 的例子)。
--
-- 内容形状(shot-structure.ts 的 ShotRecipe):
--   { duration_seconds, shot_count, cut_times[], shots[{start,duration}],
--     rhythm:{median_shot_seconds, shortest, longest, cuts_per_second},
--     hook:{shots_in_first_3s, first_cut_at},
--     measured_with:{scene_threshold, method} }
-- 测量失败时存 { error, measured_at } —— 区分「没量过(null)」和「量过但失败」。

ALTER TABLE viral_reference_library
  ADD COLUMN IF NOT EXISTS shot_recipe jsonb;

COMMENT ON COLUMN viral_reference_library.shot_recipe IS
  'ffmpeg 实测的分镜头结构(镜头数/切点/节奏/开场)。null=未测量;含 error 键=测量失败。measured_with 记录测量口径,不同阈值的数字不可直接比较。';

-- 常用筛选:找出「已量到结构」的样本做汇总
CREATE INDEX IF NOT EXISTS idx_viral_ref_measured
  ON viral_reference_library ((shot_recipe -> 'rhythm' ->> 'median_shot_seconds'))
  WHERE shot_recipe IS NOT NULL AND shot_recipe ? 'rhythm';
-- ─────────────────────────────────────────────────────────────────────────
-- ============================================================================
--  viral_reference_library 补列（生产有、仓库重建后缺的 10 列）
-- ----------------------------------------------------------------------------
--  相关账本：20260523150355 viral_reference_content_goal_and_metadata、
--            20260523160615 viral_reference_gap_analysis_fields。
--  content_goal/detected_content_goal 按生产类型定义为 text（曾有 jsonb 旧版，
--  但生产现状是 text）。全部幂等，重跑无害。
-- ============================================================================

ALTER TABLE public.viral_reference_library
  ADD COLUMN IF NOT EXISTS channel_title         text,
  ADD COLUMN IF NOT EXISTS video_title           text,
  ADD COLUMN IF NOT EXISTS view_count            bigint,
  ADD COLUMN IF NOT EXISTS like_count            bigint,
  ADD COLUMN IF NOT EXISTS published_at          timestamptz,
  ADD COLUMN IF NOT EXISTS is_learnable          boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS is_our_video          boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS view_threshold_min    integer,
  ADD COLUMN IF NOT EXISTS content_goal          text,
  ADD COLUMN IF NOT EXISTS detected_content_goal text;

-- ─────────────────────────────────────────────────────────────────────────
-- ============================================================================
-- 文件 1/2：supabase/migrations/20260729164057_contacts_pinned_at.sql
-- 版本号与表名严格对齐生产账本条目 20260729164057|contacts_pinned_at
-- 来源：transcript 原文，逐字节未改（原文本身已含 if not exists，无需追加）
-- 说明：contacts 表已有 RLS 且策略为 service_role_full(TO service_role)，
--       本次是既有表加列，不新建表，故不套 RLS 模板（沙盘已核验）。
-- ============================================================================
-- ============================================================================
--  联系人置顶
-- ----------------------------------------------------------------------------
--  「今天该联系谁」的顺序是系统算的。销售偶尔需要把某个人提到最前
--  （大单、答应了今天一定回、老板点名），但不该为此推翻整套排序规则。
--
--  用图钉而不是拖拽：拖拽要存一份完整的人工顺序，且在手机上很难点准；
--  实际需求几乎总是「把这几个提上来」，不是「精确排第 3 还是第 4」。
--
--  pinned_at 同时是「置顶了没」和「什么时候置顶的」——
--  多个置顶之间按置顶时间倒序，最近钉的在最上面。
--  日期：2026-07-30
-- ============================================================================

alter table contacts
  add column if not exists pinned_at timestamptz;

comment on column contacts.pinned_at is
  '非空 = 已置顶，值为置顶时间；同一桶内置顶的排最前，多个置顶按此时间倒序。';

-- 只索引置顶的那几行（绝大多数是 null），够小够快
create index if not exists idx_contacts_pinned
  on contacts (client_id, pinned_at desc)
  where pinned_at is not null;


-- ============================================================================
-- 文件 2/2：supabase/migrations/20260824034016_outbound_prospects_discovery_report.sql
-- 版本号与表名严格对齐生产账本条目 20260824034016|outbound_prospects_discovery_report
-- 来源：transcript 原文，逐字节未改
-- 注意：discovery_report_status 带一条 CHECK 约束（5 个取值），是本次最容易被
--       手抄吞掉的定义细节，沙盘已确认它真的建出来了。
-- 说明：outbound_prospects 表已有 RLS 且策略为 service_role_full(TO service_role)，
--       本次是既有表加列，不新建表，故不套 RLS 模板（沙盘已核验）。
-- ============================================================================
alter table outbound_prospects add column if not exists discovery_report jsonb;
alter table outbound_prospects add column if not exists discovery_report_status text
  check (discovery_report_status in ('not_run', 'running', 'completed', 'truncated', 'failed'));

comment on column outbound_prospects.discovery_report is
  '张骞完整版 Discovery 报告(DiscoveryReport,含 schema_version)。仅小范围试点填充,
   大多数行为 null — 见 docs/specs/2026-08-24-report-page-discovery-upgrade-design.md';
comment on column outbound_prospects.discovery_report_status is
  '区分"从没跑过"(null)和"跑了但失败/半成品"(failed/truncated)——不能只看
   discovery_report 是否为 null。只有 completed 且 meta.truncated=false 才可信。';
-- ─────────────────────────────────────────────────────────────────────────
-- ============================================================================
--  零散补列（3 张表 5 列 · 生产有、仓库重建后缺）
-- ----------------------------------------------------------------------------
--    execution_items.started_at
--    market_comparison.competitor_domain / competitor_position
--    projects.owner_id / status
--  来源：过去零散打进生产，从未进 git。projects.status 的 DEFAULT 'active'
--  为推断（生产实际 default 未确证，不影响列结构追平）。全部幂等，重跑无害。
-- ============================================================================

ALTER TABLE public.execution_items
  ADD COLUMN IF NOT EXISTS started_at timestamptz;

ALTER TABLE public.market_comparison
  ADD COLUMN IF NOT EXISTS competitor_domain   text,
  ADD COLUMN IF NOT EXISTS competitor_position integer;

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS owner_id uuid,
  ADD COLUMN IF NOT EXISTS status   text DEFAULT 'active';
