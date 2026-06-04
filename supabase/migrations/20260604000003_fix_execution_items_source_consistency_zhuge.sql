-- FIX: execution_items_source_consistency rejected source='zhuge' (and
-- 'proactive_signal'). The source_check constraint allows these values, but the
-- consistency constraint's CHECK expression only evaluated true for diagnostic/
-- marketing_plan/fde_manual — so every zhuge/proactive_signal INSERT violated it
-- and was rejected by Postgres.
--
-- Root cause: P24.A (20260606000001_execution_items_zhuge_source.sql) added
-- 'zhuge' to source_check but never updated source_consistency. Result: 诸葛亮
-- recommendations (source='zhuge') and anomaly-detector proactive tasks
-- (source='proactive_signal') could NEVER be written to the execution kanban —
-- the writes silently failed (caught and swallowed). Surfaced by Phase 22.E SEO
-- patrol end-to-end testing (PR #338 awaited the write, exposing the rejection).
--
-- Fix: zhuge / proactive_signal / luban / fde behave like fde_manual — neither
-- prescription_id nor marketing_plan_id is required (both NULL). Rebuild the
-- consistency constraint to allow all source values that source_check permits.
--
-- Already applied to production (CrazyContent) 2026-06-04 via MCP; this file
-- keeps the repo in sync so fresh environments get the fix.
--
-- Reference: ROADMAP.md § Phase 22.E · PR #338

ALTER TABLE execution_items
  DROP CONSTRAINT IF EXISTS execution_items_source_consistency;

ALTER TABLE execution_items
  ADD CONSTRAINT execution_items_source_consistency
  CHECK (
    (source = 'diagnostic'       AND prescription_id IS NOT NULL AND marketing_plan_id IS NULL) OR
    (source = 'marketing_plan'   AND marketing_plan_id IS NOT NULL AND prescription_id IS NULL) OR
    (source = 'fde_manual'       AND prescription_id IS NULL AND marketing_plan_id IS NULL) OR
    -- zhuge / proactive_signal / luban / fde: kanban rows with no prescription
    -- or marketing_plan anchor (both FKs NULL), same shape as fde_manual.
    (source IN ('zhuge', 'proactive_signal', 'luban', 'fde')
       AND prescription_id IS NULL AND marketing_plan_id IS NULL)
  );

COMMENT ON CONSTRAINT execution_items_source_consistency ON execution_items IS
  'FK consistency by source: diagnostic→prescription, marketing_plan→mp, '
  'all others (fde_manual/zhuge/proactive_signal/luban/fde)→neither FK. '
  'zhuge/proactive_signal added 2026-06-04 — P24.A added them to source_check '
  'but omitted them here, silently blocking all 诸葛亮 kanban writes.';
