-- Phase 34.A · Winner Reel Auto-Sync
--
-- Two tables:
--   winner_reel_sync_config: per-client sync configuration (enabled + guards + target Ad Set)
--   winner_reel_sync_log:    per-run decision audit (added / paused Ads + reasons)
--
-- RLS: service-role only (ME accesses via supabaseAdmin; no end-user Auth).

-- ────────────────────────────────────────────────────────────────────────────
-- Config: one row per client, hold sync settings
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.winner_reel_sync_config (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id             uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  enabled               boolean NOT NULL DEFAULT false,

  -- Meta context
  fb_page_id            text NOT NULL,
  ad_account_id         text NOT NULL,
  target_adset_id       text NOT NULL,

  -- Guards (defaults are Level-1 pilot-safe)
  min_active_ads        int  NOT NULL DEFAULT 3    CHECK (min_active_ads  >= 1),
  ad_min_age_days       int  NOT NULL DEFAULT 14   CHECK (ad_min_age_days >= 0),
  max_new_ads_per_run   int  NOT NULL DEFAULT 3    CHECK (max_new_ads_per_run >= 1),
  winner_min_score      int  NOT NULL DEFAULT 5    CHECK (winner_min_score >= 0),
  new_ad_default_status text NOT NULL DEFAULT 'PAUSED'
                          CHECK (new_ad_default_status IN ('PAUSED', 'ACTIVE')),
  blacklist_keywords    text[] NOT NULL DEFAULT '{}',
  slack_webhook_url     text,

  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  UNIQUE (client_id, target_adset_id)
);

CREATE INDEX IF NOT EXISTS idx_wrsc_client   ON public.winner_reel_sync_config(client_id);
CREATE INDEX IF NOT EXISTS idx_wrsc_enabled  ON public.winner_reel_sync_config(enabled) WHERE enabled = true;

ALTER TABLE public.winner_reel_sync_config ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service_role_full" ON public.winner_reel_sync_config FOR ALL USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- Log: one row per sync run (decision audit trail)
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.winner_reel_sync_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  run_at          timestamptz NOT NULL DEFAULT now(),

  posts_scanned   int NOT NULL DEFAULT 0,
  winners_found   int NOT NULL DEFAULT 0,
  ads_added       jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{ad_id, name, post_id, score}, ...]
  ads_paused      jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{ad_id, name, reason, ctr}, ...]
  guards_hit      jsonb NOT NULL DEFAULT '[]'::jsonb,   -- ['min_active_ads', 'ad_min_age_days', ...]

  status          text NOT NULL DEFAULT 'ok'
                    CHECK (status IN ('ok', 'skipped', 'error')),
  error_message   text
);

CREATE INDEX IF NOT EXISTS idx_wrsl_client_run ON public.winner_reel_sync_log(client_id, run_at DESC);
CREATE INDEX IF NOT EXISTS idx_wrsl_error      ON public.winner_reel_sync_log(status) WHERE status = 'error';

ALTER TABLE public.winner_reel_sync_log ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service_role_full" ON public.winner_reel_sync_log FOR ALL USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- Housekeeping trigger: bump updated_at on config edits
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.winner_reel_sync_config_touch_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS winner_reel_sync_config_touch ON public.winner_reel_sync_config;
CREATE TRIGGER winner_reel_sync_config_touch
  BEFORE UPDATE ON public.winner_reel_sync_config
  FOR EACH ROW EXECUTE FUNCTION public.winner_reel_sync_config_touch_updated_at();
