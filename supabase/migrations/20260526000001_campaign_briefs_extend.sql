-- ============================================================
-- P12.Q.1 — campaign_briefs 扩 6 个 nullable 字段
-- 全部使用 ADD COLUMN IF NOT EXISTS，对现有行零影响
-- ============================================================

ALTER TABLE campaign_briefs
  ADD COLUMN IF NOT EXISTS offer                 TEXT NULL,
  ADD COLUMN IF NOT EXISTS target_audience_detail TEXT NULL,
  ADD COLUMN IF NOT EXISTS proof_points          TEXT NULL,
  ADD COLUMN IF NOT EXISTS primary_cta           TEXT NULL,
  ADD COLUMN IF NOT EXISTS channel_goal          TEXT NULL,
  ADD COLUMN IF NOT EXISTS campaign_angle        TEXT NULL;
