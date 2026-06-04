-- supabase/migrations/20260625000001_a21_goal_current_value.sql
-- ============================================================================
-- A2.1-γ — Goal current_value auto-update + clients.brand_aliases hardening
-- ============================================================================
-- Adds:
--   1. goals.current_value (numeric, nullable)
--   2. goals.current_value_fetched_at (timestamptz, nullable)
--   3. goals.current_value_source (text, nullable; 'auto.cron' | 'auto.manual' | 'self_report')
--   4. clients.brand_aliases → hardens existing nullable column to NOT NULL DEFAULT '{}'
--
-- NOTE: clients.brand_aliases was added by 20260624010000_client_brand_aliases.sql
-- as text[] nullable. This migration hardens it to NOT NULL DEFAULT '{}' per spec
-- v3.1 requirement, then pre-fills aliases for the 2 pilot clients (CTS Tours NZ,
-- Oztop) to support Chinese/English brand-name matching in industry AI visibility
-- snapshots. FDE can add more aliases later via UI.
--
-- Spec ref: docs/superpowers/specs/2026-06-04-a21-stepc-design-v3.md (v3.1)
-- ============================================================================

-- 1. goals: add current_value columns
ALTER TABLE goals
  ADD COLUMN IF NOT EXISTS current_value           numeric,
  ADD COLUMN IF NOT EXISTS current_value_fetched_at timestamptz,
  ADD COLUMN IF NOT EXISTS current_value_source     text;

CREATE INDEX IF NOT EXISTS goals_current_value_fetched_at_idx
  ON goals (current_value_fetched_at)
  WHERE status = 'active';

COMMENT ON COLUMN goals.current_value IS
  'Auto-fetched current progress value. Updated by goal-current-value-refresh cron (03:00 UTC) or VerdictPanel manual button. NULL when metric measurement=self_report.';
COMMENT ON COLUMN goals.current_value_source IS
  'Origin: auto.cron (daily cron) | auto.manual (VerdictPanel button) | self_report (FDE typed in)';

-- 2. clients.brand_aliases: harden nullable → NOT NULL DEFAULT '{}'
-- First back-fill any NULLs so the NOT NULL constraint does not fail
UPDATE clients SET brand_aliases = '{}' WHERE brand_aliases IS NULL;

ALTER TABLE clients
  ALTER COLUMN brand_aliases SET DEFAULT '{}',
  ALTER COLUMN brand_aliases SET NOT NULL;

-- 3. Pre-fill aliases for 2 pilot clients (魏征 v3.1 P1-C decision)
UPDATE clients
SET brand_aliases = ARRAY['中国旅行社', '中旅', 'CTS', 'CTS Tours NZ']
WHERE name = 'CTS Tours NZ' OR name = '[QA] CTS Tours NZ';

UPDATE clients
SET brand_aliases = ARRAY['Oztop Flooring', 'Oztop', 'oztop building']
WHERE name = 'oztop' OR name = '[QA] Oztop Building';
