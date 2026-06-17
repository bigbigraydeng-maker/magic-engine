-- P18.B.2 — promote google_ads_customer_id to a first-class `clients` column.
--
-- Until now the customer_id has lived in two scattered places:
--   1. platform_oauth_connections.account_id (when a client OAuthed in)
--   2. flywheel_actions.payload->>'customer_id' (when a manual action recorded it)
--
-- Both are fragile: (1) only exists if the OAuth flow has run, (2) is buried
-- inside per-action JSON. Neither is queryable from the clients dashboard or
-- discoverable by a new operator. Move it to a real column so the cron, the
-- execute route, and the upcoming settings UI all read from the same place.
--
-- Backwards compatibility:
--   - The column is nullable. Existing clients see NULL until backfilled.
--   - PR #1 (google-ads-daily-cron) still reads from platform_oauth_connections;
--     the loadGoogleAdsCredsForClient() helper introduced in this PR adds a
--     `clients.google_ads_customer_id` lookup at the front of the chain and
--     falls back to the old sources, so neither path regresses.
--   - No data is migrated automatically. FDE / admin will populate the column
--     via the Phase 18.B.3 settings UI once it ships.
--
-- RLS: clients table already enables service_role_full per CLAUDE.md template
-- (rls_service_role_full migration). New column inherits the policy — no
-- additional GRANT / POLICY needed. Confirmed by grepping current state.

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS google_ads_customer_id text;

COMMENT ON COLUMN public.clients.google_ads_customer_id IS
  'Google Ads 10-digit customer ID (no dashes). Populated by FDE via the Phase 18.B.3 settings UI. Primary source for cron + execute routes; falls back to platform_oauth_connections.account_id when null.';
