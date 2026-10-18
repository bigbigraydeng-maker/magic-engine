-- Let platform_oauth_connections accept provider 'google_youtube'
-- (one row per client + channel id; account_id = YouTube channel id).
-- Keeps all 9 existing values (verified against 20261013160100_platform_oauth_add_whatsapp.sql,
-- the last migration that rewrote this constraint) and adds one.
-- Reversible: remove 'google_youtube' from the array (after deleting google_youtube rows).

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
    'whatsapp'::text,
    'google_youtube'::text
  ]));
