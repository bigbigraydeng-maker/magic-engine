-- ============================================================================
-- 广告支柱 IMPACT 升级 · 阶段 1 · 只读诊断的数据地基
-- 设计：~/.claude/plans/ads-impact-loop-capability.md §2.1 / §2.2 / §14 M1 / M9
--
-- ⚠️ 本文件只随 PR 提交，**不在 PR 内 apply**。apply 是单独授权的运维动作，需 PM 显式 go。
--
-- ── 一、ad_entity_snapshots：广告设置快照（只在设置变化时记一行，另每天一次）────────
-- 为什么不是给 ad_daily_insights 加列：设置是维度不是每日指标；一天中途改了预算/受众，
-- 按天一行会把「那天用的是哪套设置」记错。Check 段需要「动作发生当时的设置」。
--
-- level：
--   account   账户状态/时区/币种（D1、D7 用）
--   campaign  目标、预算层级（CBO/ABO）、预算、出价、特殊广告类别（读系列自己的）
--   adset     优化目标、转化位置、预算、包含/排除受众、Advantage+ 受众、名单外扩展、学习阶段
--   ad        所属广告组/系列（§14 M1：主结果归属链 广告→广告组→系列 需要它）
--   audience  自定义受众：人数下限、规则里的 object_id（D4 按 object_id 判，不按名字）、建成时间
--
-- 共用账户（§14 M9）：同一广告账户登记给多个客户时（2026-09-14 实查 Roman HU 与 30 Kiteroa
-- 同登记 act_1260456876069575），在落广告系列级归属表之前**只写 account 级**并标 shared_account，
-- 绝不把另一客户的实体写进本客户名下。
--
-- 回执以 action_runs 为准（§14 M1），本表不做回执；capture_reason 里的 kernel_pre/kernel_post
-- 为阶段 2 内核运行前后抓快照预留。
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.ad_entity_snapshots (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id              uuid        NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  platform               text        NOT NULL DEFAULT 'meta',
  ad_account_id          text        NOT NULL,
  level                  text        NOT NULL
    CHECK (level IN ('account', 'campaign', 'adset', 'ad', 'audience')),
  entity_id              text        NOT NULL,
  entity_name            text,
  campaign_id            text,
  adset_id               text,

  -- 投放状态
  status                 text,
  effective_status       text,

  -- 系列/广告组设置
  objective              text,
  optimization_goal      text,
  destination_type       text,
  -- 'cbo' = 预算挂在系列上；'abo' = 挂在广告组上；账户/广告/受众为 NULL
  budget_level           text        CHECK (budget_level IS NULL OR budget_level IN ('cbo', 'abo')),
  -- Meta 返回的最小货币单位（分），保留原值不换算
  daily_budget_minor     bigint,
  lifetime_budget_minor  bigint,
  currency               text,
  bid_strategy           text,
  special_ad_categories  text[]      NOT NULL DEFAULT '{}',
  smart_promotion_type   text,
  included_audience_ids  text[]      NOT NULL DEFAULT '{}',
  excluded_audience_ids  text[]      NOT NULL DEFAULT '{}',
  -- targeting.targeting_automation.advantage_audience（0/1，读不到为 NULL）
  advantage_audience     smallint,
  -- targeting.targeting_relaxation_types 原样（如 {"custom_audience":0,"lookalike":0}）
  targeting_relaxation   jsonb,
  -- 定向摘要（地区/年龄等，只做人看和变化比对，不做判定）
  targeting_summary      jsonb,
  learning_stage         text,
  -- 该实体当前所在的 Meta 实验（ad_studies）：[{id,type,start_time,end_time}]
  ad_studies             jsonb       NOT NULL DEFAULT '[]'::jsonb,

  -- 广告级：创意里的视频 id（creative.video_id）与主页 id。D4 按「视频受众规则 object_id ∩ 破冰广告视频」
  -- 判是否攒了人，不按名字判（2026-09-14 实拉核对：NAL 视频池规则 object_id 与 ThruPlay 广告 video_id 一致）
  creative_video_ids     text[]      NOT NULL DEFAULT '{}',
  creative_page_id       text,

  -- 账户级
  account_status         integer,
  disable_reason         integer,
  timezone_name          text,

  -- 受众级
  audience_subtype       text,
  audience_count_lower   bigint,
  audience_rule_object_ids text[]    NOT NULL DEFAULT '{}',
  audience_rule_events   text[]      NOT NULL DEFAULT '{}',
  audience_retention_days integer,
  audience_created_at    timestamptz,

  shared_account         boolean     NOT NULL DEFAULT false,
  -- 设置字段的规范化哈希；与上一行相同就不写（只有 daily 例外）
  settings_hash          text        NOT NULL,
  -- first_seen   近 30 天第一次看到这个实体（不算「设置变化」，K12 72 小时计数要排除）
  -- changed      设置哈希与上一行不同
  -- daily        设置没变，今天（账户时区）还没记过
  -- disappeared  上一行还在，但这一层**读全了**却没返回它（归档/删除/状态出了读取范围）
  -- kernel_pre / kernel_post  阶段 2 内核运行前后强制抓
  capture_reason         text        NOT NULL
    CHECK (capture_reason IN ('first_seen', 'changed', 'daily', 'disappeared', 'kernel_pre', 'kernel_post')),
  source_updated_time    timestamptz,
  captured_at            timestamptz NOT NULL DEFAULT now(),
  created_at             timestamptz NOT NULL DEFAULT now()
);

-- 读「某实体在时刻 T 的设置」：按实体取 captured_at <= T 的最新一行
CREATE INDEX IF NOT EXISTS idx_ad_entity_snapshots_entity_time
  ON public.ad_entity_snapshots (client_id, level, entity_id, captured_at DESC);

-- 读「某客户某账户在时刻 T 的全部设置」
CREATE INDEX IF NOT EXISTS idx_ad_entity_snapshots_client_time
  ON public.ad_entity_snapshots (client_id, ad_account_id, captured_at DESC);

ALTER TABLE public.ad_entity_snapshots ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  -- 🔴 必须写 TO service_role。漏掉 = 对匿名访客敞开读写（2026-08-03 实测教训）。
  CREATE POLICY "service_role_full" ON public.ad_entity_snapshots
    FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 一点五、ad_snapshot_captures：每一轮、每个账户、每个层级「抓过了没有、抓全了没有」────
-- 快照只在设置变化时记行，两行之间隔几天是正常的。只看快照表分不出「真没变」和「那几个小时
-- 根本没抓到 / 抓了没抓全」（2026-09-14 子牙复审 B1）。Check 段判「两次快照间有空档 →
-- not_comparable」（§14 M1）靠的是这张表，不是运行日志。
CREATE TABLE IF NOT EXISTS public.ad_snapshot_captures (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id      uuid        NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  ad_account_id  text        NOT NULL,
  level          text        NOT NULL
    CHECK (level IN ('account', 'campaign', 'adset', 'ad', 'audience')),
  captured_at    timestamptz NOT NULL,
  -- 这一层这一轮是否读全（读全了才允许据此判「消失」、据此判「期间没变」）
  complete       boolean     NOT NULL,
  -- 共用账户按设计只读账户级，其它层级记 skipped_shared（不是失败，也不能当「没变」）
  skipped_shared boolean     NOT NULL DEFAULT false,
  rows_written   integer     NOT NULL DEFAULT 0,
  error          text,
  capture_reason text        NOT NULL DEFAULT 'scheduled'
    CHECK (capture_reason IN ('scheduled', 'kernel_pre', 'kernel_post')),
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ad_snapshot_captures_account_time
  ON public.ad_snapshot_captures (client_id, ad_account_id, level, captured_at DESC);

ALTER TABLE public.ad_snapshot_captures ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  -- 🔴 必须写 TO service_role。
  CREATE POLICY "service_role_full" ON public.ad_snapshot_captures
    FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 二、ad_daily_insights 加列（§2.2）──────────────────────────────────────────
-- 视频完播：D4「攒了人没收割」、角色指标都要。原始 actions 整包：结果阶梯由客户配置决定，
-- 不用每换一种结果就改表。广告组级沿用既有 level='adset'（不改表）。小时数据不入库。
ALTER TABLE public.ad_daily_insights
  ADD COLUMN IF NOT EXISTS video_3s_views          integer,
  ADD COLUMN IF NOT EXISTS video_thruplays         integer,
  ADD COLUMN IF NOT EXISTS video_p25               integer,
  ADD COLUMN IF NOT EXISTS video_p50               integer,
  ADD COLUMN IF NOT EXISTS video_p75               integer,
  ADD COLUMN IF NOT EXISTS video_p95               integer,
  ADD COLUMN IF NOT EXISTS video_p100              integer,
  ADD COLUMN IF NOT EXISTS video_avg_watch_seconds numeric,
  ADD COLUMN IF NOT EXISTS actions                 jsonb;

NOTIFY pgrst, 'reload schema';
