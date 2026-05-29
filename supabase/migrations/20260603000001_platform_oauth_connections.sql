-- Platform OAuth Connections — multi-provider OAuth 2.0 per client
-- Phase 24.A.1
--
-- Why a new table instead of extending google_oauth_tokens (20260524000001):
--   1. google_oauth_tokens stores tokens in PLAINTEXT — security risk
--   2. UNIQUE (client_id) only allows one Google connection per client
--   3. No provider field — not extensible to Meta / TikTok / Google Ads
--   4. No GBP location_name field
--   This table supersedes google_oauth_tokens for all future OAuth work.
--   google_oauth_tokens is left in place (backward-compat) but no longer written to.

CREATE TABLE platform_oauth_connections (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id         UUID        NOT NULL REFERENCES clients(id) ON DELETE CASCADE,

  provider          TEXT        NOT NULL
                    CHECK (provider IN ('google_gbp', 'google_gsc', 'meta', 'tiktok', 'google_ads')),

  -- Tokens encrypted with AES-256-GCM (env: CMS_TOKEN_ENCRYPTION_KEY)
  -- Format: base64(iv) + '.' + base64(authTag) + '.' + base64(ciphertext)
  access_token_enc  TEXT        NOT NULL,
  refresh_token_enc TEXT        NOT NULL,
  token_expiry      TIMESTAMPTZ NOT NULL,

  account_id        TEXT        NOT NULL,   -- Google account ID / Meta page ID
  location_name     TEXT,                   -- GBP only: "accounts/{id}/locations/{id}"
  display_name      TEXT        NOT NULL,   -- Human label, e.g. "OzTop Brisbane GBP"
  scopes            TEXT[]      NOT NULL DEFAULT '{}',

  status            TEXT        NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'revoked', 'expired', 'error')),

  last_synced_at    TIMESTAMPTZ,
  error_message     TEXT,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- One active connection per client + provider + account
  UNIQUE (client_id, provider, account_id)
);

CREATE INDEX idx_platform_oauth_client_id
  ON platform_oauth_connections(client_id);

CREATE INDEX idx_platform_oauth_client_provider
  ON platform_oauth_connections(client_id, provider);

COMMENT ON TABLE platform_oauth_connections IS
  'OAuth 2.0 platform connections (GBP / GSC / Meta / TikTok / Google Ads). '
  'Tokens are AES-256-GCM encrypted. Phase 24.';
