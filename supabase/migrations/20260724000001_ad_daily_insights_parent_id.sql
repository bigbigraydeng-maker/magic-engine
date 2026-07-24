-- P21.K.7 — ad-level rows need to know which campaign they belong to.
--
-- The P21.K.1 table already reserved `level` for 'ad', so ad rows themselves
-- need no schema change. What it did NOT reserve is a parent pointer, and
-- without one an ad row is an orphan: you can see a new ad appeared account-wide
-- on 7/17, but not that it appeared inside the campaign whose CPL doubled —
-- which is the entire Oztop Lead Form Cold Broad question this level exists to
-- answer.
--
-- Nullable and additive: campaign rows keep writing without it (they are their
-- own top level), and ad rows store NULL when Meta omits campaign attribution
-- rather than inventing a parent.

ALTER TABLE ad_daily_insights ADD COLUMN IF NOT EXISTS parent_id TEXT;

COMMENT ON COLUMN ad_daily_insights.parent_id IS
  'Owning entity one level up: campaign_id for level=''ad''. NULL for level=''campaign''.';

-- "Every ad inside campaign X over the last N days" — the read that turns a
-- campaign-level alert into a named culprit. Partial: campaign rows all carry
-- NULL here and have no business in this index.
CREATE INDEX IF NOT EXISTS idx_ad_daily_insights_parent_series
  ON ad_daily_insights (client_id, parent_id, insight_date DESC)
  WHERE parent_id IS NOT NULL;
