-- Phase 22.D.2 — extend execution_items.source to allow 'proactive_signal'
--
-- The Zhugeliang Proactive endpoint (POST /api/ai/zhugeliang/proactive) writes
-- advisory execution items generated from anomaly_signals detections. These need
-- a distinct source value so the execution board can render the ⚡ 系统检测 badge
-- (P22.D.4).
--
-- Applied: manually via Supabase dashboard → SQL editor

-- Drop the existing check constraint and recreate with proactive_signal added.
ALTER TABLE execution_items DROP CONSTRAINT IF EXISTS execution_items_source_check;
ALTER TABLE execution_items ADD CONSTRAINT execution_items_source_check
  CHECK (source IN ('zhuge', 'fde', 'luban', 'proactive_signal'));

-- Add anomaly_signal_id FK so the kanban row links back to the originating signal.
ALTER TABLE execution_items
  ADD COLUMN IF NOT EXISTS anomaly_signal_id UUID
    REFERENCES anomaly_signals(id) ON DELETE SET NULL;

COMMENT ON COLUMN execution_items.anomaly_signal_id IS
  'P22.D.2 — FK to anomaly_signals row that triggered this proactive advisory.';
