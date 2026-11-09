-- ============================================================================
-- 广告支柱 IMPACT 升级 · 阶段 2 · 客户自治配置（spec 2026-09-24 §3 G1 / §14 M4）
--
-- ⚠️ 本文件只随 PR 提交，**不在 PR 内 apply**。apply 需 PM 显式 go。
--
-- 复用既有 `ad_strategy_configs`（每客户一行的广告引擎配置），不另建表：
--   daily_budget_cap_cents   每客户广告日预算上限（账户币种，分）。NULL = 未设 →
--                            自治一律 observe（缺行按锁定，绝不默认放开动钱）
--   autonomy_mode            observe = 只巡察不动钱；bounded_auto = 信封内自动执行
--   creative_pool            素材池（jsonb 数组），approved_by 只能由服务端从会话派生
--
-- 改这些字段只能走 /api/clients/[id]/ad-strategy-config（仅内部员工），不许进数据库直改。
--
-- RLS：本表已有策略，2026-08-03 migration 20260803020000 已统一收回到 TO service_role。
-- ============================================================================

ALTER TABLE public.ad_strategy_configs
  ADD COLUMN IF NOT EXISTS daily_budget_cap_cents integer,
  ADD COLUMN IF NOT EXISTS autonomy_mode text NOT NULL DEFAULT 'observe',
  ADD COLUMN IF NOT EXISTS creative_pool jsonb NOT NULL DEFAULT '[]'::jsonb;

DO $do$ BEGIN
  ALTER TABLE public.ad_strategy_configs ADD CONSTRAINT ad_strategy_configs_autonomy_mode_chk
    CHECK (autonomy_mode IN ('observe','bounded_auto'));
EXCEPTION WHEN duplicate_object THEN NULL; END $do$;

DO $do$ BEGIN
  ALTER TABLE public.ad_strategy_configs ADD CONSTRAINT ad_strategy_configs_daily_cap_chk
    CHECK (daily_budget_cap_cents IS NULL OR daily_budget_cap_cents > 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $do$;

COMMENT ON COLUMN public.ad_strategy_configs.daily_budget_cap_cents IS
  '每客户广告日预算上限（账户币种，分）。NULL = 未设 → 自治一律 observe（spec 2026-09-24 §3 G1 / §14 M4 缺行按锁定）';

COMMENT ON COLUMN public.ad_strategy_configs.autonomy_mode IS
  'observe = 只巡察不动钱；bounded_auto = 信封内自动执行（PM 2026-09-24 拍板）。只能走 /api/clients/[id]/ad-strategy-config（仅内部员工）改';

COMMENT ON COLUMN public.ad_strategy_configs.creative_pool IS
  '素材池 [{kind:''meta_video''|''work_order'', ref, status:''candidate''|''approved'', approved_by?, approved_at?}]。approved_by 只能由服务端从会话派生，绝不接受客户端传入（2026-08-04 事故规则）';

NOTIFY pgrst, 'reload schema';
