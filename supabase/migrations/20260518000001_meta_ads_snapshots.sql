-- P12.B.2: Meta Ads snapshots table + clients.meta_ad_account_id
-- MetaAdsAdapter.pullMetrics() reads from this table (populated by the sync route).
-- Reference: ROADMAP.md P12.B.2

-- ── §1: clients — add Meta ad account field ───────────────────────────────────

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS meta_ad_account_id TEXT;

COMMENT ON COLUMN clients.meta_ad_account_id IS
  'Meta (Facebook) ad account ID, e.g. "act_123456789". Used by MetaAdsAdapter.';

-- ── §2: meta_ads_snapshots ────────────────────────────────────────────────────
-- One row per sync run per client. Synced by /api/clients/[id]/meta-ads/sync.
-- Stores account-level aggregates for the requested date range.

CREATE TABLE IF NOT EXISTS meta_ads_snapshots (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  ad_account_id   TEXT NOT NULL,
  period_start    DATE NOT NULL,
  period_end      DATE NOT NULL,

  -- Key metrics (nullable: API may not return all fields)
  spend           NUMERIC,         -- total spend in account currency
  impressions     BIGINT,
  clicks          BIGINT,
  conversions     BIGINT,
  roas            NUMERIC,         -- purchase_roas (if conversion tracking enabled)
  cpc             NUMERIC,         -- cost per click
  ctr             NUMERIC,         -- click-through rate (0–1)

  raw_data        JSONB,           -- full API response for re-processing
  fetched_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_meta_ads_snapshots_client
  ON meta_ads_snapshots(client_id, fetched_at DESC);

ALTER TABLE meta_ads_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full"
  ON meta_ads_snapshots FOR ALL USING (true);

COMMENT ON TABLE meta_ads_snapshots IS
  'Meta Ads account-level metrics snapshots. Written by /api/clients/[id]/meta-ads/sync.';
