-- 常驻探测手 · anomaly_signals 扩列
--
-- 背景：anomaly_signals 是给「比数值」的旧规则引擎建的
-- （current_value / reference_value / delta_pct）。常驻探测手产出的是另一种东西：
--   什么变了 / 影响多少钱 / 已经多久了 / 该不该自动处理。
-- 这些事实现在只能挤进 description 字符串里，看得见但查不了、排不了序。
--
-- 全部列可空 + 有默认值，旧行不受影响，旧代码路径照跑。
-- 代码侧已做好两态兼容：这个 migration 没 apply 之前，
-- WatcherJob.persistWatchSignals 自动退回只写旧列（事实仍在 description 里，不丢）。
-- 所以本文件可以由 PM 随时 apply，不需要配合发版时间。

ALTER TABLE anomaly_signals
  ADD COLUMN IF NOT EXISTS watcher_id text,
  ADD COLUMN IF NOT EXISTS entity_id text,
  ADD COLUMN IF NOT EXISTS entity_name text,
  ADD COLUMN IF NOT EXISTS what_changed text,
  ADD COLUMN IF NOT EXISTS money_impact_aud numeric,
  ADD COLUMN IF NOT EXISTS money_basis text,
  ADD COLUMN IF NOT EXISTS days_ongoing integer,
  ADD COLUMN IF NOT EXISTS disposition text,
  ADD COLUMN IF NOT EXISTS disposition_reason text,
  ADD COLUMN IF NOT EXISTS observed_through date,
  ADD COLUMN IF NOT EXISTS requires_manual_verification boolean NOT NULL DEFAULT false;

-- 三条分流线的受控词表。第一版 auto 只判定不执行。
DO $$ BEGIN
  ALTER TABLE anomaly_signals
    ADD CONSTRAINT anomaly_signals_disposition_check
    CHECK (disposition IS NULL OR disposition IN ('auto', 'needs_approval'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 同一个广告系列反复报同一件事时，靠 (客户, 规则, 对象) 去重。
CREATE INDEX IF NOT EXISTS idx_anomaly_signals_client_rule_entity
  ON anomaly_signals (client_id, rule_id, entity_id);

-- 「今天有哪些待办」是这张表最高频的读法。
CREATE INDEX IF NOT EXISTS idx_anomaly_signals_fresh_detected
  ON anomaly_signals (status, detected_at DESC);

-- RLS：本仓一律 service-role 模板（ME 走 supabaseAdmin，不用 end-user RLS）。
-- anomaly_signals 建表时已 ENABLE + 建过 service_role 策略，这里不重复处理。
