-- P17.B.1: Add campaign-level breakdown column to meta_ads_snapshots
-- Stores top campaigns by spend as JSONB (mirrors top_queries / top_sources pattern).

ALTER TABLE meta_ads_snapshots
  ADD COLUMN IF NOT EXISTS campaigns JSONB;

COMMENT ON COLUMN meta_ads_snapshots.campaigns IS
  'Top campaigns by spend for this period. Array of {campaign_id, campaign_name, spend, impressions, clicks, roas, ctr}.';
