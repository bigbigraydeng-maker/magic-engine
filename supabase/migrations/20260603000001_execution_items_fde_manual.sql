-- Phase 20.D: Add fde_manual source to execution_items
-- FDE can now record work directly from any of the 6 pillars without needing
-- a prescription or marketing_plan as the source anchor.
--
-- Reference: ROADMAP.md Phase 20.D · ME_Kanban_Evolution_Final.docx

-- ── §1: Extend source CHECK ───────────────────────────────────────────────────
-- Add 'fde_manual' to the allowed source values.

ALTER TABLE execution_items
  DROP CONSTRAINT IF EXISTS execution_items_source_check;

ALTER TABLE execution_items
  ADD CONSTRAINT execution_items_source_check
  CHECK (source IN ('diagnostic', 'marketing_plan', 'fde_manual'));

-- ── §2: Relax source consistency constraint ───────────────────────────────────
-- fde_manual tasks have no prescription_id and no marketing_plan_id — both
-- FKs are NULL, which is intentional (they originate from FDE direct entry).

ALTER TABLE execution_items
  DROP CONSTRAINT IF EXISTS execution_items_source_consistency;

ALTER TABLE execution_items
  ADD CONSTRAINT execution_items_source_consistency
  CHECK (
    (source = 'diagnostic'     AND prescription_id IS NOT NULL AND marketing_plan_id IS NULL) OR
    (source = 'marketing_plan' AND marketing_plan_id IS NOT NULL AND prescription_id IS NULL) OR
    (source = 'fde_manual'     AND prescription_id IS NULL AND marketing_plan_id IS NULL)
  );

-- ── §3: Composite index for FDE manual tasks (client + source + sort) ─────────

CREATE INDEX IF NOT EXISTS idx_execution_items_fde_manual_client
  ON execution_items(client_id, sort_order)
  WHERE source = 'fde_manual';

COMMENT ON CONSTRAINT execution_items_source_consistency ON execution_items IS
  'Enforces FK consistency by source: diagnostic→prescription, marketing_plan→mp, fde_manual→neither FK required';
