-- ============================================================
-- social_plans: add execution_item_id for precise plan recall
-- 2026-06-17
--
-- Problem: social_plans was only linked to execution_items via
-- campaign_id, which is ambiguous when:
--   1. A client has multiple campaigns
--   2. Tasks are manually added mid-campaign
--   3. Campaign changes between generations
--
-- Fix: add execution_item_id FK so each plan can be recalled
-- exactly for its task, regardless of campaign state.
-- Column is nullable to preserve backwards compat with existing rows.
-- ============================================================

ALTER TABLE public.social_plans
  ADD COLUMN IF NOT EXISTS execution_item_id UUID
    REFERENCES public.execution_items(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS social_plans_execution_item_id_idx
  ON public.social_plans(execution_item_id)
  WHERE execution_item_id IS NOT NULL;
