-- Per-client Meta token migration: move tokens from Render env vars to DB.
-- Additive, service-role-only. A-level: touches auth/credentials.
--
-- Adds 'meta_client_token' to the purpose CHECK constraint so we can store
-- per-client Meta system user / user access tokens in platform_oauth_connections
-- instead of Render environment variables.

-- 1. Drop the auto-generated inline CHECK on `purpose`.
ALTER TABLE public.platform_oauth_connections
  DROP CONSTRAINT platform_oauth_connections_purpose_check;

-- 2. Re-add with the new value included.
ALTER TABLE public.platform_oauth_connections
  ADD CONSTRAINT platform_oauth_connections_purpose_check
  CHECK (purpose IN ('legacy', 'meta_ads_read', 'meta_client_token'));
