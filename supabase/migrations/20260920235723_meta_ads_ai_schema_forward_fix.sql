-- #1839. Forward-only repair for the isolated Meta Ads AI preview schema.
-- Apply only after explicit release approval. Existing unowned read connections
-- are quarantined and require fresh OAuth; this migration never guesses an owner.
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TEMP TABLE meta_ads_ai_forward_fix_mode (
  legacy_preview boolean NOT NULL
) ON COMMIT DROP;

DO $$
DECLARE
  has_pilot_table boolean := to_regclass('public.meta_ads_ai_pilot_entitlements') IS NOT NULL;
  has_connection_owner boolean := EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='platform_oauth_connections'
      AND column_name='authorizing_principal_id'
  );
  has_connection_revision boolean := EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='platform_oauth_connections'
      AND column_name='entitlement_revision'
  );
  has_grant_revision boolean := EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='meta_ads_read_grants'
      AND column_name='entitlement_revision'
  );
  has_state_revision boolean := EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='meta_ads_oauth_states'
      AND column_name='entitlement_revision'
  );
  entitlement_function_count integer := (
    SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN (
      'meta_ads_authorization_current','meta_ads_discovery_current',
      'meta_ads_entitlement_revision_guard','meta_ads_active_entitlement',
      'meta_ads_connection_entitlement_guard'
    )
  );
  entitlement_trigger_count integer := (
    SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
    WHERE NOT t.tgisinternal AND c.relnamespace='public'::regnamespace
      AND t.tgname IN ('meta_ads_entitlement_revision','meta_ads_connection_entitlement')
  );
BEGIN
  IF to_regclass('public.platform_oauth_connections') IS NULL
     OR to_regclass('public.client_api_keys') IS NULL
     OR to_regclass('public.client_binding_audit') IS NULL
     OR to_regclass('public.meta_ads_read_grants') IS NULL
     OR to_regclass('public.meta_ads_oauth_states') IS NULL
     OR to_regclass('public.meta_ads_read_limits') IS NULL
     OR to_regclass('public.meta_ads_binding_lock') IS NULL THEN
    RAISE EXCEPTION 'unsupported Meta Ads AI schema: required foundation objects are missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='platform_oauth_connections' AND column_name='purpose'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='client_api_keys' AND column_name='expires_at'
  ) THEN
    RAISE EXCEPTION 'unsupported Meta Ads AI schema: preview foundation fingerprint mismatch';
  END IF;

  IF NOT has_pilot_table AND NOT has_connection_owner AND NOT has_connection_revision
     AND NOT has_grant_revision AND NOT has_state_revision
     AND entitlement_function_count=0 AND entitlement_trigger_count=0 THEN
    INSERT INTO meta_ads_ai_forward_fix_mode VALUES (true);
  ELSIF has_pilot_table AND has_connection_owner AND has_connection_revision
     AND has_grant_revision AND has_state_revision
     AND entitlement_function_count=5 AND entitlement_trigger_count=2 THEN
    INSERT INTO meta_ads_ai_forward_fix_mode VALUES (false);
  ELSE
    RAISE EXCEPTION 'unsupported Meta Ads AI schema: partial entitlement upgrade detected';
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS public.meta_ads_ai_pilot_entitlements (
  client_id uuid PRIMARY KEY REFERENCES public.clients(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'paused', 'revoked')),
  starts_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  revision uuid NOT NULL DEFAULT gen_random_uuid(),
  approved_by_email text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK(expires_at IS NULL OR expires_at > starts_at),
  UNIQUE(client_id,revision)
);

LOCK TABLE public.clients, public.client_meta_ad_accounts,
  public.platform_oauth_connections, public.client_api_keys,
  public.client_binding_audit, public.meta_ads_ai_pilot_entitlements,
  public.meta_ads_read_grants, public.meta_ads_oauth_states,
  public.meta_ads_read_limits, public.meta_ads_binding_lock
  IN ACCESS EXCLUSIVE MODE;

DROP TRIGGER IF EXISTS meta_ads_entitlement_revision ON public.meta_ads_ai_pilot_entitlements;
DROP TRIGGER IF EXISTS meta_ads_grant_guard ON public.meta_ads_read_grants;
DROP TRIGGER IF EXISTS meta_ads_registry_guard ON public.client_meta_ad_accounts;
DROP TRIGGER IF EXISTS meta_ads_legacy_guard ON public.clients;
DROP TRIGGER IF EXISTS meta_ads_connection_entitlement ON public.platform_oauth_connections;
DROP TRIGGER IF EXISTS meta_ads_connection_invalidate ON public.platform_oauth_connections;

-- Preserve the invitation surface, but require a real approver to activate it.
INSERT INTO public.meta_ads_ai_pilot_entitlements(client_id,status,approved_by_email)
SELECT DISTINCT source.client_id, 'paused', 'migration:pending-approval'
FROM (
  SELECT client_id FROM public.platform_oauth_connections WHERE purpose='meta_ads_read'
  UNION
  SELECT client_id FROM public.meta_ads_read_grants
) source
CROSS JOIN meta_ads_ai_forward_fix_mode mode
WHERE mode.legacy_preview
ON CONFLICT (client_id) DO NOTHING;

-- Keep an audit receipt without logging tokens or provider payloads.
INSERT INTO public.client_binding_audit(
  client_id,binding_kind,actor_email,action,previous_value,outcome,detail
)
SELECT c.client_id,'meta_ads_read','migration:20260920235723','clear',c.id::text,'applied',
  'Schema repair quarantined an ownerless Meta Ads read connection; fresh OAuth is required.'
FROM public.platform_oauth_connections c
CROSS JOIN meta_ads_ai_forward_fix_mode mode
WHERE mode.legacy_preview AND c.purpose='meta_ads_read';

INSERT INTO public.client_binding_audit(
  client_id,binding_kind,actor_email,action,previous_value,outcome,detail
)
SELECT k.client_id,'meta_ads_read','migration:20260920235723','clear',k.id::text,'applied',
  'Schema repair revoked a legacy Meta Ads AI key; fresh authorization is required.'
FROM public.client_api_keys k
CROSS JOIN meta_ads_ai_forward_fix_mode mode
WHERE mode.legacy_preview AND k.revoked_at IS NULL AND 'meta:ads:read'=ANY(k.scopes);

UPDATE public.client_api_keys k
SET revoked_at=now()
FROM meta_ads_ai_forward_fix_mode mode
WHERE mode.legacy_preview AND k.revoked_at IS NULL AND 'meta:ads:read'=ANY(k.scopes);

DELETE FROM public.meta_ads_oauth_states s
USING meta_ads_ai_forward_fix_mode mode
WHERE mode.legacy_preview;

UPDATE public.platform_oauth_connections c
SET status='revoked', updated_at=now()
FROM meta_ads_ai_forward_fix_mode mode
WHERE mode.legacy_preview AND c.purpose='meta_ads_read';

-- A grant cannot prove who completed OAuth, so none are adopted into the new owner model.
DELETE FROM public.meta_ads_read_grants g
USING meta_ads_ai_forward_fix_mode mode
WHERE mode.legacy_preview;

ALTER TABLE public.platform_oauth_connections
  ADD COLUMN IF NOT EXISTS authorizing_principal_id uuid,
  ADD COLUMN IF NOT EXISTS entitlement_revision uuid;
ALTER TABLE public.meta_ads_read_grants
  ADD COLUMN IF NOT EXISTS entitlement_revision uuid;
ALTER TABLE public.meta_ads_oauth_states
  ADD COLUMN IF NOT EXISTS entitlement_revision uuid;

ALTER TABLE public.meta_ads_read_grants ALTER COLUMN entitlement_revision SET NOT NULL;
ALTER TABLE public.meta_ads_oauth_states ALTER COLUMN entitlement_revision SET NOT NULL;

ALTER TABLE public.platform_oauth_connections DROP CONSTRAINT IF EXISTS meta_ads_connection_identity;
ALTER TABLE public.platform_oauth_connections ADD CONSTRAINT meta_ads_connection_identity CHECK (
  purpose <> 'meta_ads_read' OR (
    provider='meta' AND account_id ~ '^ads_user:[0-9]+$'
    AND (status <> 'active' OR (
      authorizing_principal_id IS NOT NULL AND entitlement_revision IS NOT NULL
    ))
  )
);

CREATE INDEX IF NOT EXISTS meta_ads_read_grants_client_idx
  ON public.meta_ads_read_grants(client_id);
CREATE INDEX IF NOT EXISTS meta_ads_read_grants_connection_idx
  ON public.meta_ads_read_grants(connection_id);
CREATE INDEX IF NOT EXISTS meta_ads_oauth_states_client_expiry_idx
  ON public.meta_ads_oauth_states(client_id,expires_at);

ALTER TABLE public.meta_ads_read_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meta_ads_ai_pilot_entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meta_ads_oauth_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meta_ads_read_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meta_ads_binding_lock ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies p
    WHERE p.schemaname='public'
      AND p.tablename IN ('meta_ads_read_grants','meta_ads_ai_pilot_entitlements',
        'meta_ads_oauth_states','meta_ads_read_limits','meta_ads_binding_lock')
      AND EXISTS (SELECT 1 FROM unnest(p.roles) role_name WHERE role_name::text <> 'service_role')
  ) THEN
    RAISE EXCEPTION 'unsafe Meta Ads AI policy detected during schema repair';
  END IF;
END;
$$;

DROP POLICY IF EXISTS service_role_full ON public.meta_ads_read_grants;
DROP POLICY IF EXISTS service_role_full ON public.meta_ads_ai_pilot_entitlements;
DROP POLICY IF EXISTS service_role_full ON public.meta_ads_oauth_states;
DROP POLICY IF EXISTS service_role_full ON public.meta_ads_read_limits;
DROP POLICY IF EXISTS service_role_full ON public.meta_ads_binding_lock;
CREATE POLICY service_role_full ON public.meta_ads_read_grants FOR ALL TO service_role USING(true) WITH CHECK(true);
CREATE POLICY service_role_full ON public.meta_ads_ai_pilot_entitlements FOR ALL TO service_role USING(true) WITH CHECK(true);
CREATE POLICY service_role_full ON public.meta_ads_oauth_states FOR ALL TO service_role USING(true) WITH CHECK(true);
CREATE POLICY service_role_full ON public.meta_ads_read_limits FOR ALL TO service_role USING(true) WITH CHECK(true);
CREATE POLICY service_role_full ON public.meta_ads_binding_lock FOR ALL TO service_role USING(true) WITH CHECK(true);

REVOKE ALL ON public.meta_ads_read_grants, public.meta_ads_ai_pilot_entitlements,
  public.meta_ads_oauth_states, public.meta_ads_read_limits, public.meta_ads_binding_lock
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.meta_ads_read_grants, public.meta_ads_ai_pilot_entitlements,
  public.meta_ads_oauth_states, public.meta_ads_read_limits, public.meta_ads_binding_lock
  TO service_role;

COMMENT ON TABLE public.meta_ads_ai_pilot_entitlements IS
  'Server-side invitation gate for the read-only Meta Ads AI pilot. A retained inactive row preserves exit and data-request access.';
COMMENT ON COLUMN public.platform_oauth_connections.authorizing_principal_id IS
  'ME user who completed provider OAuth. Required for active meta_ads_read connections.';

CREATE OR REPLACE FUNCTION public.meta_ads_entitlement_revision_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF OLD.status='revoked' OR NEW.status='revoked'
     OR (OLD.expires_at IS NOT NULL AND OLD.expires_at<=now() AND (NEW.expires_at IS NULL OR NEW.expires_at>now())) THEN
    NEW.revision:=gen_random_uuid();
  ELSE
    NEW.revision:=OLD.revision;
  END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.meta_ads_active_entitlement(tenant uuid,rev uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = '' AS $$
 SELECT EXISTS(SELECT 1 FROM public.meta_ads_ai_pilot_entitlements e WHERE e.client_id=tenant AND e.revision=rev
   AND e.status='active' AND e.starts_at<=now() AND (e.expires_at IS NULL OR e.expires_at>now()));
$$;

CREATE OR REPLACE FUNCTION public.meta_ads_authorization_current(tenant uuid,key_id uuid,account text) RETURNS boolean
LANGUAGE sql STABLE SET search_path = '' AS $$
 SELECT EXISTS(
   SELECT 1 FROM public.client_api_keys k
   JOIN public.meta_ads_read_grants g ON g.id=(k.metadata->>'meta_ads_grant_id')::uuid AND g.client_id=k.client_id
   JOIN public.platform_oauth_connections c ON c.id=g.connection_id AND c.client_id=g.client_id
   JOIN public.meta_ads_ai_pilot_entitlements e ON e.client_id=g.client_id
   WHERE k.id=key_id AND k.client_id=tenant AND k.revoked_at IS NULL AND k.expires_at>now()
     AND 'meta:ads:read'=ANY(k.scopes) AND g.ad_account_id=account AND g.revoked_at IS NULL
     AND (k.metadata->>'meta_ads_grant_revision')::uuid=g.revision
     AND (k.metadata->>'meta_ads_entitlement_revision')::uuid=g.entitlement_revision
     AND (k.metadata->>'meta_ads_principal_id')::uuid=g.principal_id
     AND c.purpose='meta_ads_read' AND c.provider='meta' AND c.status='active' AND c.token_expiry>now()
     AND 'ads_read'=ANY(c.scopes) AND c.authorizing_principal_id=g.principal_id
     AND c.entitlement_revision=g.entitlement_revision AND e.revision=g.entitlement_revision
     AND e.status='active' AND e.starts_at<=now() AND (e.expires_at IS NULL OR e.expires_at>now())
     AND NOT public.meta_ads_account_conflict(tenant,account)
 );
$$;

CREATE OR REPLACE FUNCTION public.meta_ads_discovery_current(
  tenant uuid,conn_id uuid,principal uuid,expected_version timestamptz
) RETURNS boolean LANGUAGE sql STABLE SET search_path = '' AS $$
 SELECT EXISTS(
   SELECT 1 FROM public.platform_oauth_connections c
   JOIN public.meta_ads_ai_pilot_entitlements e ON e.client_id=c.client_id AND e.revision=c.entitlement_revision
   WHERE c.id=conn_id AND c.client_id=tenant AND c.authorizing_principal_id=principal AND c.updated_at=expected_version
     AND c.purpose='meta_ads_read' AND c.provider='meta' AND c.status='active' AND c.token_expiry>now()
     AND 'ads_read'=ANY(c.scopes) AND e.status='active' AND e.starts_at<=now() AND (e.expires_at IS NULL OR e.expires_at>now())
 );
$$;

CREATE OR REPLACE FUNCTION public.meta_ads_binding_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE tenant uuid; account text;
BEGIN
 UPDATE public.meta_ads_binding_lock SET revision=revision+1 WHERE id=true;
 IF TG_TABLE_NAME='meta_ads_read_grants' THEN
   IF TG_OP='UPDATE' AND (NEW.client_id IS DISTINCT FROM OLD.client_id OR NEW.ad_account_id IS DISTINCT FROM OLD.ad_account_id
      OR NEW.principal_id IS DISTINCT FROM OLD.principal_id) THEN
     RAISE EXCEPTION 'grant ownership is immutable' USING ERRCODE='23514';
   END IF;
   NEW.revision := gen_random_uuid();
   IF NEW.revoked_at IS NOT NULL THEN RETURN NEW; END IF;
   IF NOT public.meta_ads_active_entitlement(NEW.client_id,NEW.entitlement_revision) THEN
     RAISE EXCEPTION 'inactive pilot entitlement' USING ERRCODE='23514';
   END IF;
   IF NOT EXISTS(SELECT 1 FROM public.platform_oauth_connections c WHERE c.id=NEW.connection_id AND c.client_id=NEW.client_id
      AND c.purpose='meta_ads_read' AND c.provider='meta' AND c.status='active' AND c.token_expiry>now() AND 'ads_read'=ANY(c.scopes)
      AND c.entitlement_revision=NEW.entitlement_revision AND c.authorizing_principal_id=NEW.principal_id) THEN
     RAISE EXCEPTION 'invalid read connection' USING ERRCODE='23514';
   END IF;
   IF public.meta_ads_account_conflict(NEW.client_id, NEW.ad_account_id) THEN
     RAISE EXCEPTION 'account unavailable' USING ERRCODE='23514';
   END IF;
 ELSE
   IF TG_TABLE_NAME='clients' THEN tenant:=NEW.id; account:=NEW.meta_ad_account_id;
   ELSE tenant:=NEW.client_id; account:=NEW.ad_account_id; END IF;
   IF EXISTS(SELECT 1 FROM public.meta_ads_read_grants g WHERE g.client_id<>tenant AND g.revoked_at IS NULL
     AND public.meta_ads_registered_match(account,g.ad_account_id)) THEN
     RAISE EXCEPTION 'account unavailable' USING ERRCODE='23514';
   END IF;
 END IF;
 RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.meta_ads_connection_entitlement_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
 IF NEW.purpose='meta_ads_read' THEN
   IF TG_OP='UPDATE' AND NEW.authorizing_principal_id IS DISTINCT FROM OLD.authorizing_principal_id
      AND NOT (
        OLD.purpose='meta_ads_read' AND OLD.status IN ('revoked','expired','error')
        AND OLD.authorizing_principal_id IS NULL
        AND NEW.status='active' AND NEW.authorizing_principal_id IS NOT NULL
        AND NEW.access_token_enc IS DISTINCT FROM OLD.access_token_enc
      ) THEN
     RAISE EXCEPTION 'connection owner is immutable' USING ERRCODE='23514';
   END IF;
   IF NEW.status='active' AND NOT public.meta_ads_active_entitlement(NEW.client_id,NEW.entitlement_revision) THEN
     RAISE EXCEPTION 'inactive pilot entitlement' USING ERRCODE='23514';
   END IF;
 END IF;
 RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.meta_ads_connection_changed() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
 IF OLD.purpose='meta_ads_read' AND (
      OLD.access_token_enc IS DISTINCT FROM NEW.access_token_enc
      OR OLD.status IS DISTINCT FROM NEW.status
      OR OLD.entitlement_revision IS DISTINCT FROM NEW.entitlement_revision
      OR OLD.authorizing_principal_id IS DISTINCT FROM NEW.authorizing_principal_id
    ) THEN
   UPDATE public.meta_ads_binding_lock SET revision=revision+1 WHERE id=true;
   UPDATE public.meta_ads_read_grants SET revoked_at=now() WHERE connection_id=OLD.id AND revoked_at IS NULL;
 END IF;
 RETURN NEW;
END; $$;

CREATE TRIGGER meta_ads_entitlement_revision BEFORE UPDATE ON public.meta_ads_ai_pilot_entitlements
  FOR EACH ROW EXECUTE FUNCTION public.meta_ads_entitlement_revision_guard();
CREATE TRIGGER meta_ads_grant_guard BEFORE INSERT OR UPDATE ON public.meta_ads_read_grants
  FOR EACH ROW EXECUTE FUNCTION public.meta_ads_binding_guard();
CREATE TRIGGER meta_ads_registry_guard BEFORE INSERT OR UPDATE OF client_id,ad_account_id ON public.client_meta_ad_accounts
  FOR EACH ROW EXECUTE FUNCTION public.meta_ads_binding_guard();
CREATE TRIGGER meta_ads_legacy_guard BEFORE INSERT OR UPDATE OF meta_ad_account_id ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public.meta_ads_binding_guard();
CREATE TRIGGER meta_ads_connection_entitlement BEFORE INSERT OR UPDATE ON public.platform_oauth_connections
  FOR EACH ROW EXECUTE FUNCTION public.meta_ads_connection_entitlement_guard();
CREATE TRIGGER meta_ads_connection_invalidate
  AFTER UPDATE OF access_token_enc,status,entitlement_revision,authorizing_principal_id
  ON public.platform_oauth_connections FOR EACH ROW EXECUTE FUNCTION public.meta_ads_connection_changed();

REVOKE ALL ON FUNCTION public.meta_ads_registered_match(text,text),
  public.meta_ads_account_conflict(uuid,text),
  public.meta_ads_authorization_current(uuid,uuid,text),
  public.meta_ads_discovery_current(uuid,uuid,uuid,timestamptz),
  public.meta_ads_binding_guard(), public.meta_ads_reserve_read(uuid),
  public.meta_ads_entitlement_revision_guard(), public.meta_ads_active_entitlement(uuid,uuid),
  public.meta_ads_connection_entitlement_guard(), public.meta_ads_connection_changed()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.meta_ads_registered_match(text,text),
  public.meta_ads_account_conflict(uuid,text),
  public.meta_ads_authorization_current(uuid,uuid,text),
  public.meta_ads_discovery_current(uuid,uuid,uuid,timestamptz),
  public.meta_ads_binding_guard(), public.meta_ads_reserve_read(uuid),
  public.meta_ads_entitlement_revision_guard(), public.meta_ads_active_entitlement(uuid,uuid),
  public.meta_ads_connection_entitlement_guard(), public.meta_ads_connection_changed()
  TO service_role;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.platform_oauth_connections
    WHERE purpose='meta_ads_read' AND status='active'
      AND (authorizing_principal_id IS NULL OR entitlement_revision IS NULL)
  ) THEN
    RAISE EXCEPTION 'active Meta Ads read connection lacks owner or entitlement revision';
  END IF;
  IF EXISTS (SELECT 1 FROM public.meta_ads_read_grants WHERE entitlement_revision IS NULL)
     OR EXISTS (SELECT 1 FROM public.meta_ads_oauth_states WHERE entitlement_revision IS NULL) THEN
    RAISE EXCEPTION 'Meta Ads AI entitlement revision backfill is incomplete';
  END IF;
END;
$$;

COMMIT;
