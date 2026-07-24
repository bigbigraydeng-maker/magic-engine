-- P21.K.5 — Ad Strategy Engine per-client configuration.
--
-- The engine itself is already client-agnostic: it judges every campaign
-- against that campaign's OWN historical baseline (relative, not absolute), so
-- no CTS-specific numbers leak into how another client is scored. This table
-- adds the per-client CONTROL surface a real product needs — an on/off switch
-- and where the daily digest goes — edited through a Settings UI (never SQL),
-- per the FDE-config red-line.
--
-- Deliberately NOT here: per-campaign thresholds. The original spec envisioned
-- them for an absolute-threshold design; the relative-baseline redesign made
-- them unnecessary (a campaign is measured against itself, universally).

CREATE TABLE IF NOT EXISTS ad_strategy_configs (
  client_id          UUID PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,

  -- Master switch. Clients with a Meta account are evaluated by default; an FDE
  -- can turn a client off here without touching the connector.
  enabled            BOOLEAN NOT NULL DEFAULT true,

  -- Where this client's daily digest goes. Empty → the global ME inbox
  -- (AD_HEALTH_DIGEST_TO). Lets each client's FDE receive their own.
  digest_recipients  TEXT[] NOT NULL DEFAULT '{}',

  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE ad_strategy_configs ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "service_role_full" ON ad_strategy_configs FOR ALL USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
