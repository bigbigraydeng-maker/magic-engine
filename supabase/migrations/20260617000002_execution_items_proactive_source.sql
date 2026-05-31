-- P22.D.2: execution_items — add 'proactive_signal' source value
-- AnomalyDetectorJob-triggered items need their own source tag
-- so the kanban can show the ⚡ 系统检测 badge (P22.D.4).

ALTER TABLE execution_items DROP CONSTRAINT IF EXISTS execution_items_source_check;
ALTER TABLE execution_items ADD CONSTRAINT execution_items_source_check
  CHECK (source IN ('zhuge', 'fde', 'luban', 'proactive_signal', 'fde_manual', 'diagnostic', 'marketing_plan'));

-- Index: fast lookup of proactive items by client + status
CREATE INDEX IF NOT EXISTS idx_execution_items_proactive
  ON execution_items(client_id, status)
  WHERE source = 'proactive_signal';
