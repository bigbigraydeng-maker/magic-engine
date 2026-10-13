-- Let platform_oauth_connections accept provider 'whatsapp' (one row per client + phone_number_id,
-- account_id = phone_number_id, access_token_enc = that number's own token).
-- Keeps all 8 existing values (verified against 20260811150000_platform_oauth_add_ga4_gtm.sql,
-- the last migration that rewrote this constraint) and adds one.
-- Reversible: remove 'whatsapp' from the array (after deleting whatsapp rows).

ALTER TABLE platform_oauth_connections
  DROP CONSTRAINT IF EXISTS platform_oauth_connections_provider_check;

ALTER TABLE platform_oauth_connections
  ADD CONSTRAINT platform_oauth_connections_provider_check
  CHECK (provider = ANY (ARRAY[
    'google_gbp'::text,
    'google_gsc'::text,
    'meta'::text,
    'tiktok'::text,
    'google_ads'::text,
    'microsoft_mail'::text,
    'google_ga4'::text,
    'google_gtm'::text,
    'whatsapp'::text
  ]));
