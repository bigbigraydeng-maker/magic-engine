-- ============================================================================
-- Phase 33 M1: Strategy-Execution Bridge
-- ============================================================================
-- 连接 Goal/Initiative 策略层和 Campaign/Marketing Plan/Kanban 执行层。
--
-- 改动：
--   1. initiatives 加 campaign_ids uuid[]（Initiative 关联哪些 Campaign）
--   2. marketing_plans 加 initiative_id uuid（Plan 归属哪个 Initiative）
--
-- 注意：execution_items.initiative_id 已在 Phase 31 migration 建立，无需重复。
-- ============================================================================

-- P33.1: initiatives 关联 campaigns
ALTER TABLE initiatives
  ADD COLUMN IF NOT EXISTS campaign_ids uuid[] DEFAULT '{}';

COMMENT ON COLUMN initiatives.campaign_ids IS
  'Campaign UUIDs linked to this initiative. FDE manually associates campaigns; not a FK array so deletions do not cascade automatically.';

-- P33.2: marketing_plans 关联 initiative
ALTER TABLE marketing_plans
  ADD COLUMN IF NOT EXISTS initiative_id uuid REFERENCES initiatives(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_marketing_plans_initiative_id
  ON marketing_plans(initiative_id);

COMMENT ON COLUMN marketing_plans.initiative_id IS
  'Initiative that this marketing plan is executing against. Populated when plan is generated from an Initiative card.';
