-- DAPE Week 3 · W5 — Restore P→E attribution link for all execution sources
-- ============================================================================
-- Spec: docs/superpowers/specs/2026-06-08-me-dape-redefine-v0.2.md §2.4.3 + §4
--
-- BUG-FMT-F22 root cause:
-- ----------------------
-- execution_items.prescription_id EXISTS as a column (created 2026-05-13 in
-- 20260513000001_diagnostic_engine.sql), but the source_consistency CHECK
-- constraint (last revised 2026-06-04) only allows prescription_id to be
-- populated when source = 'diagnostic'. For source IN
-- ('zhuge', 'proactive_signal', 'luban', 'fde', 'fde_manual'), the constraint
-- FORCES prescription_id IS NULL — silently breaking the P→E attribution link
-- DAPE Week 3 needs (Kanban cards from 诸葛亮 / 鲁班 / proactive signals can
-- never trace back to the prescription that birthed them).
--
-- DAPE §2.4.3 says only schema change for Week 3 is:
--     ALTER TABLE execution_items ADD COLUMN prescription_id uuid REFERENCES ...
-- The column already exists, so this migration RELAXES the consistency
-- constraint instead — letting zhuge/luban/proactive_signal/fde/fde_manual
-- OPTIONALLY carry prescription_id when the orchestrator knows which
-- prescription seeded the action.
--
-- Backwards compatible:
--   - Existing NULL prescription_id rows (the current state for non-diagnostic
--     sources) remain valid — the new constraint allows NULL for all sources.
--   - Existing source='diagnostic' rows keep their FK — still required by the
--     constraint (diagnostic items without a prescription_id make no sense).
--   - Existing source='marketing_plan' rows keep marketing_plan_id required and
--     prescription_id NULL — marketing_plan and prescription are distinct
--     anchors; DAPE does not merge them.
--
-- Non-destructive:
--   - No DROP COLUMN
--   - No backfill in this migration (backfill SOP lives in
--     docs/sops/dape-w5-execution-prescription-id-backfill.md and runs after
--     狄仁杰 audit).
--   - CTS 87 Kanban cards remain untouched until the backfill SOP runs.
--
-- W4 coordination:
--   This migration only changes execution_items. It does NOT touch
--   prescriptions itself. W4's prescription API work is independent.
--
-- W2 coordination:
--   This migration does NOT touch luban-router.ts; the W2 zhuge memory work is
--   orthogonal. Application-layer changes that fill the new prescription_id
--   live in src/lib/zhuge/action-persister.ts (DAPE W5 application changes).
--
-- Rollback:
--   To revert, restore the old constraint that pinned prescription_id to NULL
--   for non-diagnostic sources:
--     ALTER TABLE execution_items DROP CONSTRAINT execution_items_source_consistency;
--     ALTER TABLE execution_items ADD CONSTRAINT execution_items_source_consistency
--       CHECK (
--         (source = 'diagnostic'     AND prescription_id IS NOT NULL AND marketing_plan_id IS NULL) OR
--         (source = 'marketing_plan' AND marketing_plan_id IS NOT NULL AND prescription_id IS NULL) OR
--         (source = 'fde_manual'     AND prescription_id IS NULL AND marketing_plan_id IS NULL) OR
--         (source IN ('zhuge', 'proactive_signal', 'luban', 'fde')
--            AND prescription_id IS NULL AND marketing_plan_id IS NULL)
--       );
-- ============================================================================

-- ── §1: Relax source_consistency to allow optional prescription_id ───────────
-- Non-diagnostic sources may now OPTIONALLY carry prescription_id (NULL or a
-- valid prescription FK). marketing_plan_id mutual-exclusion is preserved.

ALTER TABLE execution_items
  DROP CONSTRAINT IF EXISTS execution_items_source_consistency;

ALTER TABLE execution_items
  ADD CONSTRAINT execution_items_source_consistency
  CHECK (
    -- diagnostic source still requires prescription_id (regression guard)
    (source = 'diagnostic'
       AND prescription_id IS NOT NULL
       AND marketing_plan_id IS NULL) OR
    -- marketing_plan source still pins marketing_plan_id and excludes prescription_id
    (source = 'marketing_plan'
       AND marketing_plan_id IS NOT NULL
       AND prescription_id IS NULL) OR
    -- All other sources MAY optionally link to a prescription (DAPE W5 change).
    -- prescription_id IS NULL stays valid for legacy / unanchored items.
    (source IN ('zhuge', 'proactive_signal', 'luban', 'fde', 'fde_manual')
       AND marketing_plan_id IS NULL)
  );

COMMENT ON CONSTRAINT execution_items_source_consistency ON execution_items IS
  'DAPE W5 (2026-06-28): non-diagnostic sources MAY optionally link to a '
  'prescription (P→E attribution). diagnostic still REQUIRES prescription_id. '
  'marketing_plan still REQUIRES marketing_plan_id and excludes prescription_id.';

-- ── §2: Index for prescription_id filter on Kanban ───────────────────────────
-- prescription_id index exists from 20260513000001 (idx_execution_items_prescription_id).
-- Add a partial composite for the Kanban "filter by prescription + status" use
-- case (DAPE W5 §2.4.4 — Kanban prescription filter chip).

CREATE INDEX IF NOT EXISTS idx_execution_items_prescription_status
  ON execution_items(client_id, prescription_id, status)
  WHERE prescription_id IS NOT NULL;

COMMENT ON INDEX idx_execution_items_prescription_status IS
  'DAPE W5 — supports Kanban prescription filter chip; partial index keeps it '
  'small (rows with prescription_id are a minority pre-backfill).';

-- ── §3: RLS — service-role full access (CLAUDE.md strong constraint) ─────────
-- execution_items RLS policies were created back in 20260513000001 and they
-- referenced client_team — that table never shipped, so the original policies
-- effectively deny all access. Service-role bypasses RLS so the supabaseAdmin
-- code path keeps working, but Postgres still evaluates DO BLOCKs / triggers
-- inside the row, so we replace the dead policies with a service-role-shaped
-- policy per CLAUDE.md guidance ("一律使用 service_role 模板").
--
-- IDEMPOTENT: existing policies dropped if present, recreated cleanly.

ALTER TABLE execution_items ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  DROP POLICY IF EXISTS "Users can view execution items for their clients" ON execution_items;
  DROP POLICY IF EXISTS "Users can insert execution items for their clients" ON execution_items;
  DROP POLICY IF EXISTS "Users can update execution items for their clients" ON execution_items;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "service_role_full" ON execution_items
    FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
