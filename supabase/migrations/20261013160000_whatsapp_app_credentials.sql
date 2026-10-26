-- WhatsApp: which Meta app's secret signs the webhook for a given phone number.
-- Why a table: platform_oauth_connections has no field that means "app secret" (refresh_token_enc
-- is a refresh token and is unique per client). The secret belongs to the Meta app, looked up
-- by the phone_number_id found in the webhook payload. Tokens stay in platform_oauth_connections.
-- Design: docs/specs/2026-10-13-whatsapp-per-app-verify-per-number-token-v1.md
-- Rollout order: apply this migration BEFORE deploying the code that reads it. Empty table =
-- current behaviour (META_APP_SECRET env var verifies everything).
-- Reversible: DROP TABLE public.whatsapp_app_credentials;

CREATE TABLE IF NOT EXISTS public.whatsapp_app_credentials (
  phone_number_id text PRIMARY KEY CHECK (phone_number_id ~ '^[0-9]{1,32}$'),
  app_secret_enc  text NOT NULL,
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.whatsapp_app_credentials ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS service_role_full ON public.whatsapp_app_credentials;
CREATE POLICY service_role_full ON public.whatsapp_app_credentials
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.whatsapp_app_credentials FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.whatsapp_app_credentials TO service_role;

COMMENT ON TABLE public.whatsapp_app_credentials IS
  'Per-phone-number Meta app secret (AES-256-GCM, same key as platform_oauth_connections) used to verify X-Hub-Signature-256 on /api/webhooks/whatsapp. No row = fall back to META_APP_SECRET.';
