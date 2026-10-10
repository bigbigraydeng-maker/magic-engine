-- ============================================================================
-- 广告支柱 IMPACT 升级 · 阶段 1 · 客户结果阶梯配置（设计 §3.2 / §7 L4 / §14 M2）
--
-- ⚠️ 本文件只随 PR 提交，**不在 PR 内 apply**。apply 需 PM 显式 go。
--
-- 复用既有 `ad_strategy_configs`（每客户一行的广告引擎配置），不另建表：
--   leading_result           领先结果（每天能数），如 私信开聊 / 留资
--   primary_result           主结果（真生意），如 合格询盘 / 成交
--   target_cost_per_primary  客户目标单次主结果成本（账户币种主单位）。NULL = 未配置 →
--                            D3「花钱没结果」返回 not_comparable，**不回落行业默认值**（红线 7）
--   min_primary_per_unit     D5 每个预算单位主结果最低数（样本量闸）
--
-- 取值是封闭词表，与 src/lib/ads-strategy/portfolio/outcome-ladder.ts 的 OUTCOME_STEPS 一致。
-- 行业默认（物流/旅游/地产/电商各选哪两级）是剧本数据，不写进库；库里只存客户自己选的。
-- 改这些字段只能走设置界面（/api/clients/[id]/ad-outcome-config，仅内部员工），不许进数据库直改。
--
-- RLS：本表已有策略，2026-08-03 migration 20260803020000 已统一收回到 TO service_role。
-- ============================================================================

ALTER TABLE public.ad_strategy_configs
  ADD COLUMN IF NOT EXISTS leading_result           text,
  ADD COLUMN IF NOT EXISTS primary_result           text,
  ADD COLUMN IF NOT EXISTS target_cost_per_primary  numeric,
  ADD COLUMN IF NOT EXISTS min_primary_per_unit     integer NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS outcome_config_updated_by text,
  ADD COLUMN IF NOT EXISTS outcome_config_updated_at timestamptz;

DO $$ BEGIN
  ALTER TABLE public.ad_strategy_configs ADD CONSTRAINT ad_strategy_configs_leading_result_chk
    CHECK (leading_result IS NULL OR leading_result IN
      ('reach','video_complete','engagement','messaging_started','messaging_depth_3','lead','qualified_enquiry','deal'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.ad_strategy_configs ADD CONSTRAINT ad_strategy_configs_primary_result_chk
    CHECK (primary_result IS NULL OR primary_result IN
      ('reach','video_complete','engagement','messaging_started','messaging_depth_3','lead','qualified_enquiry','deal'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.ad_strategy_configs ADD CONSTRAINT ad_strategy_configs_target_cost_chk
    CHECK (target_cost_per_primary IS NULL OR target_cost_per_primary > 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.ad_strategy_configs ADD CONSTRAINT ad_strategy_configs_min_primary_chk
    CHECK (min_primary_per_unit >= 1);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

NOTIFY pgrst, 'reload schema';
