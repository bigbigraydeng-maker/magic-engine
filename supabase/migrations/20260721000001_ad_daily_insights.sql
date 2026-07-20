-- P21.K.1 — Ad Strategy Engine data spine
--
-- Per-campaign, per-day advertising time series.
--
-- WHY A NEW TABLE (not an extension of meta_ads_snapshots):
--   meta_ads_snapshots stores ONE row per client per run holding a 30-day
--   ROLLING AGGREGATE, with campaign data buried in a `campaigns` JSONB blob
--   truncated to the top 10 by spend. Consecutive rows overlap by 29 days, so
--   row-over-row differences do not equal daily values (attribution backfill
--   pollutes them). None of that can answer "has this campaign's CTR decayed
--   30% versus its own best week", which is the Ad Strategy Engine's main
--   fatigue judgement (spec §12).
--   meta_ads_snapshots is left untouched — MetaAdsAdapter, the monthly report
--   and the production-package view all still read it.
--
-- ATTRIBUTION NOTE (spec §5):
--   Rows are keyed per campaign on purpose. An ad account is NOT assumed to
--   belong to exactly one client: CTS's account 2775766642787274 still carries
--   4 legacy Oztop campaigns (~$175 over 90d, zero spend in the last 7d;
--   confirmed by PM 2026-07-20 as historical spillover from before Oztop had
--   its own account). Any account-level rollup MUST aggregate from filtered
--   campaign rows rather than trusting an account-level total.

CREATE TABLE IF NOT EXISTS ad_daily_insights (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id      UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  ad_account_id  TEXT NOT NULL,
  platform       TEXT NOT NULL DEFAULT 'meta',
  level          TEXT NOT NULL DEFAULT 'campaign',
  entity_id      TEXT NOT NULL,
  entity_name    TEXT,
  insight_date   DATE NOT NULL,

  spend          NUMERIC,
  impressions    BIGINT,
  reach          BIGINT,
  clicks         BIGINT,

  -- Daily frequency (impressions / reach for THIS day).
  frequency      NUMERIC,
  -- Trailing 7-day window frequency as of insight_date. Populated only for
  -- dates where the window was actually fetched (normally the latest date of a
  -- run). Frequency is NOT additive: averaging seven daily values does not
  -- yield the 7-day figure, because reach deduplicates people across the
  -- window. It therefore has to be requested for the window itself.
  -- ⚠️ CONTRACT: this column is SPARSE — during a 30-day backfill only the
  -- newest day carries a value, the rest are NULL. Downstream baseline queries
  -- MUST filter `WHERE frequency_7d IS NOT NULL`; never take a median/avg over
  -- the raw column or NULLs will skew it. Use the daily `frequency` column
  -- (dense, every day) if you need a per-day series.
  frequency_7d   NUMERIC,

  cpm            NUMERIC,
  -- Stored as a FRACTION (0.0318 = 3.18%), matching MetaCampaignInsight.ctr.
  ctr            NUMERIC,
  cpc            NUMERIC,

  leads                    INTEGER NOT NULL DEFAULT 0,
  messaging_conversations  INTEGER NOT NULL DEFAULT 0,
  -- leads + messaging_conversations — the north-star unit ("leads + WhatsApp
  -- enquiries"). Stored rather than computed so downstream reads stay simple.
  results                  INTEGER NOT NULL DEFAULT 0,
  cost_per_result          NUMERIC,

  fetched_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Idempotency key: re-running a day's pull updates in place instead of
-- appending. meta_ads_snapshots lacks this, which is why it can only insert.
CREATE UNIQUE INDEX IF NOT EXISTS ad_daily_insights_entity_day_key
  ON ad_daily_insights (client_id, platform, level, entity_id, insight_date);

-- Trend reads: one campaign's series, newest first.
CREATE INDEX IF NOT EXISTS idx_ad_daily_insights_entity_series
  ON ad_daily_insights (client_id, entity_id, insight_date DESC);

-- Dashboard reads: everything for a client on recent dates.
CREATE INDEX IF NOT EXISTS idx_ad_daily_insights_client_date
  ON ad_daily_insights (client_id, insight_date DESC);

ALTER TABLE ad_daily_insights ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "service_role_full" ON ad_daily_insights FOR ALL USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
