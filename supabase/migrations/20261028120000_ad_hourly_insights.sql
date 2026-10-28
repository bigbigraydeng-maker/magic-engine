-- 20261028120000_ad_hourly_insights.sql
--
-- IMPACT "Check": per-adset, per-hour advertising time series, so the team can look back at
-- WHICH HOURS of a day an ad set spent and produced leads / WhatsApp conversations.
--
-- WHY A NEW TABLE (not extra columns on ad_daily_insights):
--   ad_daily_insights is one row per entity per DAY (unique key has no hour). Adding an
--   hour to that key would change the contract every downstream reader (health, digest,
--   diagnostics) relies on. Hourly rows live apart; nothing existing reads this table.
--
-- DATA SOURCE: Meta Insights, level=adset, breakdown hourly_stats_aggregated_by_advertiser_time_zone.
--   `hour` is the hour of day (0-23) in the AD ACCOUNT's time zone (`account_timezone`).
--   Reach / frequency are NOT stored: Meta does not return them with the hourly breakdown.
--
-- Filled by the existing daily Meta pull (google-data-pullback-daily); no new schedule.
-- Idempotent: re-pulling a (adset, day, hour) updates in place.
--
-- ROLLBACK: DROP TABLE public.ad_hourly_insights;  (no other table references it)

CREATE TABLE IF NOT EXISTS public.ad_hourly_insights (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id                UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  ad_account_id            TEXT NOT NULL,
  platform                 TEXT NOT NULL DEFAULT 'meta',
  level                    TEXT NOT NULL DEFAULT 'adset',
  entity_id                TEXT NOT NULL,
  entity_name              TEXT,
  parent_id                TEXT,
  insight_date             DATE NOT NULL,
  hour                     SMALLINT NOT NULL CHECK (hour BETWEEN 0 AND 23),
  account_timezone         TEXT,

  spend                    NUMERIC,
  impressions              BIGINT,
  clicks                   BIGINT,
  cpm                      NUMERIC,
  -- FRACTION (0.0318 = 3.18%), same convention as ad_daily_insights.ctr.
  ctr                      NUMERIC,
  cpc                      NUMERIC,

  leads                    INTEGER NOT NULL DEFAULT 0,
  messaging_conversations  INTEGER NOT NULL DEFAULT 0,
  -- max(leads, messaging_conversations) — same "never summed" rule as ad_daily_insights.
  results                  INTEGER NOT NULL DEFAULT 0,
  cost_per_result          NUMERIC,

  fetched_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Idempotency key for the daily upsert.
CREATE UNIQUE INDEX IF NOT EXISTS ad_hourly_insights_entity_hour_key
  ON public.ad_hourly_insights (client_id, platform, level, entity_id, insight_date, hour);

-- One ad set's history, newest first.
CREATE INDEX IF NOT EXISTS idx_ad_hourly_insights_entity_series
  ON public.ad_hourly_insights (client_id, entity_id, insight_date DESC, hour);

-- Everything for a client on recent dates.
CREATE INDEX IF NOT EXISTS idx_ad_hourly_insights_client_date
  ON public.ad_hourly_insights (client_id, insight_date DESC);

ALTER TABLE public.ad_hourly_insights ENABLE ROW LEVEL SECURITY;

-- service-role-only: `TO service_role` is mandatory — omitting it opens the table to anonymous visitors.
DO $$ BEGIN
  CREATE POLICY "service_role_full" ON public.ad_hourly_insights
    FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
