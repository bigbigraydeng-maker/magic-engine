-- Instagram Login: identity only. Preserves every existing provider.
-- Prepared only; enabling the feature requires applying this migration first.
BEGIN;

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
    'google_youtube'::text,
    'instagram'::text
  ]));

COMMIT;
