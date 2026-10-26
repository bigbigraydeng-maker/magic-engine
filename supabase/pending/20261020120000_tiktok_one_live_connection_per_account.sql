-- G2-lite: a TikTok account may be attached to only one client at a time.
-- Backstop for the callback guard (src/lib/platform-oauth/connection-guard.ts): two concurrent
-- authorisations of the same account can both pass the pre-check; the index makes the second fail,
-- and the callback maps that failure to "needs_team_check".
-- Revoked rows are excluded, so disconnecting an account releases it.
-- PENDING: kept out of supabase/migrations/ on purpose, so a routine `db push` cannot run it (and cannot
-- block later migrations when duplicates exist). After PM `go apply`, resolve duplicates, then move this
-- file into supabase/migrations/ (or apply it once) -- it aborts without changes if duplicates remain.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM platform_oauth_connections
    WHERE provider = 'tiktok' AND status <> 'revoked' AND account_id <> ''
    GROUP BY account_id HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'duplicate live TikTok account_id rows exist (%); revoke one before creating the index',
      (SELECT string_agg(account_id, ', ') FROM (
         SELECT account_id FROM platform_oauth_connections
         WHERE provider = 'tiktok' AND status <> 'revoked' AND account_id <> ''
         GROUP BY account_id HAVING COUNT(*) > 1) d);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_platform_oauth_tiktok_live_account
  ON platform_oauth_connections (account_id)
  WHERE provider = 'tiktok' AND status <> 'revoked' AND account_id <> '';
