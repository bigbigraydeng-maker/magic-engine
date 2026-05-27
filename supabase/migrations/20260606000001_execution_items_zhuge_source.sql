-- P24.A.1: execution_items — zhuge source support
--
-- Three changes to allow 诸葛亮-generated execution items:
--   1. prescription_id nullable  — zhuge items have no associated prescription
--   2. source column             — tracks who created the item (zhuge | fde | luban)
--   3. action_type column        — stores the zhuge action slug for dedup
--   4. zhuge_session_id FK       — links back to the zhuge_sessions row
--   5. 'superseded' enum value   — marks replaced zhuge items

-- 1. Allow prescription_id to be NULL for zhuge-sourced items
ALTER TABLE execution_items ALTER COLUMN prescription_id DROP NOT NULL;

-- 2. New enum value for replaced zhuge items
ALTER TYPE execution_item_status ADD VALUE IF NOT EXISTS 'superseded';

-- 3. Source column — default 'fde' for all existing rows (backward-compatible)
ALTER TABLE execution_items
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'fde'
    CHECK (source IN ('zhuge', 'fde', 'luban'));

-- 4. Action type slug from zhuge (nullable for fde/luban rows)
ALTER TABLE execution_items
  ADD COLUMN IF NOT EXISTS action_type TEXT;

-- 5. FK to zhuge_sessions (nullable — only populated for source='zhuge')
ALTER TABLE execution_items
  ADD COLUMN IF NOT EXISTS zhuge_session_id UUID
    REFERENCES zhuge_sessions(id) ON DELETE SET NULL;

-- Ensure the CHECK constraint allows 'zhuge' even on DBs where the column pre-existed.
-- ADD COLUMN IF NOT EXISTS is skipped when the column exists, leaving the old constraint
-- intact. Explicitly drop and recreate to guarantee the correct allowlist.
ALTER TABLE execution_items DROP CONSTRAINT IF EXISTS execution_items_source_check;
ALTER TABLE execution_items ADD CONSTRAINT execution_items_source_check
  CHECK (source IN ('zhuge', 'fde', 'luban'));

-- Index for fast dedup lookups by action_type (zhuge path)
CREATE INDEX IF NOT EXISTS idx_execution_items_client_action_pending
  ON execution_items(client_id, action_type, status)
  WHERE action_type IS NOT NULL;
