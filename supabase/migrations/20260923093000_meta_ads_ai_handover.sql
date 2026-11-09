-- #1839 handover. Forward-only, service-role-only. Apply only after explicit release approval.
-- Lets the original owner disconnect (owner -> NULL on a revoked row) so a different
-- ME member can later complete their own Meta OAuth under the existing NULL -> new owner
-- exemption. Never permits an active row to change owner. Never deletes history.
--
-- DEPLOYMENT COMPATIBILITY GATE — this is NOT a rolling deploy.
--   * Old app + new schema: the old bind() upserts on (client_id, ad_account_id),
--     which no longer exists after this migration drops that unique constraint.
--     Old writers must be stopped before the migration is applied.
--   * New app + old schema: the new revoke() clears authorizing_principal_id, which
--     the old guard rejects with 'connection owner is immutable'. The migration must
--     be applied before any new writer serves traffic.
--   Stop all Meta Ads AI writers, apply the migration, then start the new build.
--   No feature flag or dual-write path is added for this.
BEGIN;
SET LOCAL lock_timeout = '5s';

-- 1. Extend the connection owner guard with exactly one new transition:
--    non-null owner -> NULL, only while the row is being revoked and the token is unchanged.
CREATE OR REPLACE FUNCTION public.meta_ads_connection_entitlement_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $function$
BEGIN
 IF NEW.purpose='meta_ads_read' THEN
   IF TG_OP='UPDATE' AND NEW.authorizing_principal_id IS DISTINCT FROM OLD.authorizing_principal_id
      AND NOT (
        -- Existing exemption: NULL -> new owner on a fresh active OAuth.
        (OLD.purpose='meta_ads_read' AND OLD.status IN ('revoked','expired','error')
         AND OLD.authorizing_principal_id IS NULL
         AND NEW.status='active' AND NEW.authorizing_principal_id IS NOT NULL
         AND NEW.access_token_enc IS DISTINCT FROM OLD.access_token_enc)
        OR
        -- New exemption: original owner -> NULL, only on a revoke with the token untouched.
        (OLD.purpose='meta_ads_read' AND OLD.authorizing_principal_id IS NOT NULL
         AND NEW.authorizing_principal_id IS NULL
         AND NEW.status='revoked'
         AND NEW.access_token_enc IS NOT DISTINCT FROM OLD.access_token_enc)
      ) THEN
     RAISE EXCEPTION 'connection owner is immutable' USING ERRCODE='23514';
   END IF;
   IF NEW.status='active' AND NOT public.meta_ads_active_entitlement(NEW.client_id,NEW.entitlement_revision) THEN
     RAISE EXCEPTION 'inactive pilot entitlement' USING ERRCODE='23514';
   END IF;
 END IF;
 RETURN NEW;
END; $function$;

-- 2. Backfill only already-revoked meta_ads_read rows that still carry an owner.
--    Active rows, other providers, and analysis jobs are untouched. The AFTER UPDATE
--    trigger revokes any residual grants on these connections in the same transaction.
--    The audit is written from the UPDATE's own RETURNING set so it can only ever
--    describe rows this statement actually cleared — no read-then-write race.
WITH cleared AS (
  UPDATE public.platform_oauth_connections
     SET authorizing_principal_id = NULL, updated_at = now()
   WHERE purpose='meta_ads_read' AND status='revoked' AND authorizing_principal_id IS NOT NULL
  RETURNING client_id, id
)
INSERT INTO public.client_binding_audit(
  client_id,binding_kind,actor_email,action,previous_value,outcome,detail
)
SELECT client_id,'meta_ads_read','migration:20260923093000','clear',id::text,'applied',
  'Handover repair cleared the owner on an already-revoked Meta Ads read connection.'
FROM cleared;

-- 3. Drop the full-history unique on grants so a new owner can bind the same account
--    after the old grant is revoked. The global active-only index
--    meta_ads_exclusive_active_account already prevents two active grants for the
--    same ad_account_id, within a client and across clients.
ALTER TABLE public.meta_ads_read_grants
  DROP CONSTRAINT IF EXISTS meta_ads_read_grants_client_id_ad_account_id_key;

DO $do$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.platform_oauth_connections
    WHERE purpose='meta_ads_read' AND status='revoked' AND authorizing_principal_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Meta Ads AI handover backfill is incomplete';
  END IF;
END;
$do$;

COMMIT;
