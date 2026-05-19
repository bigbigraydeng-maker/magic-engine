-- P13.E: Flywheel feedback 闭环 — flywheel_actions.production_package_id
-- 将生产包与飞轮执行动作直接关联：
--   production_package → flywheel_actions → flywheel_outcomes
-- 当包状态变为 published 时，后端自动落一条 flywheel_action，
-- attribution job 即可在 window_days 后计算 outcome（归因闭环）。
-- Reference: ROADMAP.md § Phase 13.E

ALTER TABLE public.flywheel_actions
  ADD COLUMN IF NOT EXISTS production_package_id UUID
    REFERENCES public.production_packages(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_flywheel_actions_pkg
  ON public.flywheel_actions(production_package_id)
  WHERE production_package_id IS NOT NULL;
