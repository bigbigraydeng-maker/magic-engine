-- G2-lite: a TikTok account may be attached to only one client at a time.
-- Backstop for the callback guard (src/lib/platform-oauth/connection-guard.ts): two concurrent
-- authorisations of the same account can both pass the pre-check; the index makes the second fail,
-- and the callback maps that failure to "needs_team_check".
-- Revoked rows are excluded, so disconnecting an account releases it.
-- NOT auto-applied. Apply only after PM approval; it aborts (no change) if duplicates already exist.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM platform_oauth_connections
    WHERE provider = 'tiktok' AND status <> 'revoked' AND account_id <> ''
    GROUP BY account_id HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'duplicate live TikTok account_id rows exist; resolve (revoke one) before creating the index';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_platform_oauth_tiktok_live_account
  ON platform_oauth_connections (account_id)
  WHERE provider = 'tiktok' AND status <> 'revoked' AND account_id <> '';
