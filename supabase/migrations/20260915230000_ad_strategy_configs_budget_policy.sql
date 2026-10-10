-- ============================================================================
-- 广告支柱 IMPACT 升级 · 阶段 2 · 预算锁配置层（设计 §4.1 硬前置第 2 条 / §7 L4 / §14 M4）
--
-- ⚠️ 本文件只随 PR 提交，**不在 PR 内 apply**。apply 需 PM 显式 go。
--
-- 复用既有 `ad_strategy_configs`（每客户一行的广告引擎配置），不另建表：
--   budget_locked                  预算是否锁定（默认 true = 锁定，不许任何挪动）。
--                                  这是 fail-closed 在 schema 层的体现——不是靠代码猜「没有这一行」，
--                                  而是「有行但没显式填」也默认锁定。
--   total_daily_cap_minor          每日总花费上限（Meta 最小货币单位，分），NULL = 未设置这个特定上限项。
--                                  NULL **不代表放开**——放不放开只由 budget_locked 决定，两个字段语义独立。
--   per_unit_daily_change_cap_pct  单个预算单位当日累计变动上限（百分比 0-100），NULL = 用系统兜底值
--                                  （src/lib/ads-strategy/portfolio/budget-policy.ts 的
--                                  DEFAULT_PER_UNIT_DAILY_CHANGE_CAP_PCT，取自设计 §4.3「单次≤20%」）。
--   budget_policy_updated_by / _at 审计列，模式照抄 outcome_config_updated_by / _at（migration 20260914000002）。
--
-- 🔴 M4 条款：`budget_policy` 缺行按锁定处理，不许沿用 src/lib/ads-strategy/config.ts:26-28
--    那种「没有配置行 = 用默认值放开」的 fail-open 模式——那是给只读诊断引擎用的（丢数据比误开更糟），
--    这里保护的是「会不会真的动钱」，风险方向相反。schema 默认值只保护「有行但没填这列」；
--    「完全没有行」的情况必须在读函数 loadBudgetPolicy() 里再兜一次底（no_row → locked:true），
--    两层缺一不可。
--
-- 改这些字段只能走设置界面（/api/clients/[id]/ad-budget-policy，仅内部员工），不许进数据库直改。
--
-- RLS：本表已有策略，2026-08-03 migration 20260803020000 已统一收回到 TO service_role。
-- ============================================================================

ALTER TABLE public.ad_strategy_configs
  ADD COLUMN IF NOT EXISTS budget_locked                 boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS total_daily_cap_minor         bigint,
  ADD COLUMN IF NOT EXISTS per_unit_daily_change_cap_pct numeric,
  ADD COLUMN IF NOT EXISTS budget_policy_updated_by      text,
  ADD COLUMN IF NOT EXISTS budget_policy_updated_at      timestamptz;

DO $$ BEGIN
  ALTER TABLE public.ad_strategy_configs ADD CONSTRAINT ad_strategy_configs_total_daily_cap_chk
    CHECK (total_daily_cap_minor IS NULL OR total_daily_cap_minor > 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.ad_strategy_configs ADD CONSTRAINT ad_strategy_configs_per_unit_cap_pct_chk
    CHECK (per_unit_daily_change_cap_pct IS NULL OR (per_unit_daily_change_cap_pct > 0 AND per_unit_daily_change_cap_pct <= 100));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

NOTIFY pgrst, 'reload schema';
