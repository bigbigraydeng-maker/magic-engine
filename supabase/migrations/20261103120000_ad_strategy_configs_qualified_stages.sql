-- ============================================================================
-- 广告成绩单「合格客人」：客户登记哪些 CRM 阶段算合格（修复方案第 1 刀 ③，
-- 设计 docs/specs/2026-11-03-ads-scorecard-qualified-column-v0.md §4）
--
-- ⚠️ 本文件只随 PR 提交，**不在 PR 内 apply**。apply 需 PM 显式 go。
--
-- 复用既有 `ad_strategy_configs`（每客户一行），只加列，不建表：
--   qualified_stage_keys             这个客户哪些 client_pipeline_stages.stage_key 算「合格客人」。
--                                    NULL / 空 = 没设置 → 成绩单写「还没设置」，不按任何默认值猜。
--                                    不按 sort_order 切（CTS 的 no_response 排在 quoted 后面但不算合格）。
--   qualified_stages_updated_by/at   这一项自己的修改记录，不跟「广告结果怎么算」那四项共用
--                                    （那四项决定预算判断，审计要分开）。
-- 客户的合格阶段只能走设置界面（/api/clients/[id]/ad-qualified-stages，仅内部员工）写，
-- 本文件不预置任何客户的值。
--
-- RLS：本表已有策略（只放 service_role），加列不改策略。
-- ============================================================================

ALTER TABLE public.ad_strategy_configs
  ADD COLUMN IF NOT EXISTS qualified_stage_keys          text[],
  ADD COLUMN IF NOT EXISTS qualified_stages_updated_by   text,
  ADD COLUMN IF NOT EXISTS qualified_stages_updated_at   timestamptz;
