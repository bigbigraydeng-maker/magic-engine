-- #1839. Additive, service-role-only. Apply only after explicit release approval.
ALTER TABLE public.platform_oauth_connections ADD COLUMN purpose text NOT NULL DEFAULT 'legacy'
  CHECK (purpose IN ('legacy', 'meta_ads_read'));
ALTER TABLE public.platform_oauth_connections ADD COLUMN authorizing_principal_id uuid;
ALTER TABLE public.platform_oauth_connections ADD COLUMN entitlement_revision uuid;
ALTER TABLE public.platform_oauth_connections ADD CONSTRAINT meta_ads_connection_identity
  CHECK (purpose <> 'meta_ads_read' OR (provider = 'meta' AND account_id ~ '^ads_user:[0-9]+$'
    AND authorizing_principal_id IS NOT NULL AND entitlement_revision IS NOT NULL));
ALTER TABLE public.platform_oauth_connections ADD CONSTRAINT platform_connection_tenant_unique UNIQUE(id, client_id);
ALTER TABLE public.client_api_keys ADD COLUMN expires_at timestamptz;
CREATE TABLE public.meta_ads_ai_pilot_entitlements (
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
CREATE TABLE public.meta_ads_read_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  connection_id uuid NOT NULL,
  ad_account_id text NOT NULL CHECK(ad_account_id ~ '^act_[1-9][0-9]{9,24}$'),
  principal_id uuid NOT NULL,
  entitlement_revision uuid NOT NULL,
  revision uuid NOT NULL DEFAULT gen_random_uuid(),
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(connection_id, client_id) REFERENCES public.platform_oauth_connections(id, client_id) ON DELETE CASCADE,
  UNIQUE(client_id, ad_account_id)
);
CREATE UNIQUE INDEX meta_ads_exclusive_active_account ON public.meta_ads_read_grants(ad_account_id) WHERE revoked_at IS NULL;
CREATE INDEX meta_ads_read_grants_client_idx ON public.meta_ads_read_grants(client_id);
CREATE INDEX meta_ads_read_grants_connection_idx ON public.meta_ads_read_grants(connection_id);
CREATE TABLE public.meta_ads_oauth_states (
  state_hash text PRIMARY KEY,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  principal_id uuid NOT NULL,
  entitlement_revision uuid NOT NULL,
  browser_hash text NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX meta_ads_oauth_states_client_expiry_idx ON public.meta_ads_oauth_states(client_id,expires_at);
CREATE TABLE public.meta_ads_read_limits (
  client_id uuid PRIMARY KEY REFERENCES public.clients(id) ON DELETE CASCADE,
  window_start timestamptz NOT NULL DEFAULT now(),
  calls integer NOT NULL DEFAULT 0
);
-- A physical write serialises legacy and public binding writers, including RR transactions.
CREATE TABLE public.meta_ads_binding_lock (id boolean PRIMARY KEY DEFAULT true CHECK(id), revision bigint NOT NULL DEFAULT 0);
INSERT INTO public.meta_ads_binding_lock(id) VALUES(true);
ALTER TABLE public.meta_ads_read_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meta_ads_ai_pilot_entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meta_ads_oauth_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meta_ads_read_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meta_ads_binding_lock ENABLE ROW LEVEL SECURITY;
CREATE POLICY service_role_full ON public.meta_ads_read_grants FOR ALL TO service_role USING(true) WITH CHECK(true);
CREATE POLICY service_role_full ON public.meta_ads_ai_pilot_entitlements FOR ALL TO service_role USING(true) WITH CHECK(true);
CREATE POLICY service_role_full ON public.meta_ads_oauth_states FOR ALL TO service_role USING(true) WITH CHECK(true);
CREATE POLICY service_role_full ON public.meta_ads_read_limits FOR ALL TO service_role USING(true) WITH CHECK(true);
CREATE POLICY service_role_full ON public.meta_ads_binding_lock FOR ALL TO service_role USING(true) WITH CHECK(true);
REVOKE ALL ON public.meta_ads_read_grants, public.meta_ads_ai_pilot_entitlements, public.meta_ads_oauth_states, public.meta_ads_read_limits, public.meta_ads_binding_lock FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.meta_ads_read_grants, public.meta_ads_ai_pilot_entitlements, public.meta_ads_oauth_states, public.meta_ads_read_limits, public.meta_ads_binding_lock TO service_role;

COMMENT ON TABLE public.meta_ads_ai_pilot_entitlements IS
  'Server-side invitation gate for the read-only Meta Ads AI pilot. A retained inactive row preserves exit and data-request access.';
COMMENT ON COLUMN public.platform_oauth_connections.authorizing_principal_id IS
  'ME user who completed provider OAuth. Required for meta_ads_read so other tenant members cannot inherit broad account discovery.';

CREATE FUNCTION public.meta_ads_entitlement_revision_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF OLD.status='revoked' OR NEW.status='revoked'
     OR (OLD.expires_at IS NOT NULL AND OLD.expires_at<=now() AND (NEW.expires_at IS NULL OR NEW.expires_at>now())) THEN
    NEW.revision:=gen_random_uuid();
  ELSE
    NEW.revision:=OLD.revision;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER meta_ads_entitlement_revision BEFORE UPDATE ON public.meta_ads_ai_pilot_entitlements
  FOR EACH ROW EXECUTE FUNCTION public.meta_ads_entitlement_revision_guard();

CREATE FUNCTION public.meta_ads_active_entitlement(tenant uuid,rev uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = '' AS $$
 SELECT EXISTS(SELECT 1 FROM public.meta_ads_ai_pilot_entitlements e WHERE e.client_id=tenant AND e.revision=rev
   AND e.status='active' AND e.starts_at<=now() AND (e.expires_at IS NULL OR e.expires_at>now()));
$$;

CREATE FUNCTION public.meta_ads_registered_match(stored text, account text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT EXISTS(SELECT 1 FROM regexp_split_to_table(
    regexp_replace(translate(normalize(coalesce(stored,''), NFKC), U&'\00AD\0600\0601\0602\0603\0604\0605\061C\06DD\070F\08E2\180E\200B\200C\200D\200E\200F\202A\202B\202C\202D\202E\2060\2061\2062\2063\2064\2066\2067\2068\2069\206A\206B\206C\206D\206E\206F\FEFF\FFF9\FFFA\FFFB\+0110BD\+0110CD\+013430\+013431\+013432\+013433\+013434\+013435\+013436\+013437\+013438\+01BCA0\+01BCA1\+01BCA2\+01BCA3\+01D173\+01D174\+01D175\+01D176\+01D177\+01D178\+01D179\+01D17A\+0E0001\+0E0020\+0E0021\+0E0022\+0E0023\+0E0024\+0E0025\+0E0026\+0E0027\+0E0028\+0E0029\+0E002A\+0E002B\+0E002C\+0E002D\+0E002E\+0E002F\+0E0030\+0E0031\+0E0032\+0E0033\+0E0034\+0E0035\+0E0036\+0E0037\+0E0038\+0E0039\+0E003A\+0E003B\+0E003C\+0E003D\+0E003E\+0E003F\+0E0040\+0E0041\+0E0042\+0E0043\+0E0044\+0E0045\+0E0046\+0E0047\+0E0048\+0E0049\+0E004A\+0E004B\+0E004C\+0E004D\+0E004E\+0E004F\+0E0050\+0E0051\+0E0052\+0E0053\+0E0054\+0E0055\+0E0056\+0E0057\+0E0058\+0E0059\+0E005A\+0E005B\+0E005C\+0E005D\+0E005E\+0E005F\+0E0060\+0E0061\+0E0062\+0E0063\+0E0064\+0E0065\+0E0066\+0E0067\+0E0068\+0E0069\+0E006A\+0E006B\+0E006C\+0E006D\+0E006E\+0E006F\+0E0070\+0E0071\+0E0072\+0E0073\+0E0074\+0E0075\+0E0076\+0E0077\+0E0078\+0E0079\+0E007A\+0E007B\+0E007C\+0E007D\+0E007E\+0E007F',''), '\s', '', 'g'), '\D+') AS n
    WHERE ltrim(n,'0') = substring(account FROM 5));
$$;
CREATE FUNCTION public.meta_ads_account_conflict(tenant uuid, account text) RETURNS boolean
LANGUAGE sql STABLE SET search_path = '' AS $$
 SELECT EXISTS(SELECT 1 FROM public.client_meta_ad_accounts WHERE client_id <> tenant AND public.meta_ads_registered_match(ad_account_id, account))
 OR EXISTS(SELECT 1 FROM public.clients WHERE id <> tenant AND public.meta_ads_registered_match(meta_ad_account_id, account))
 OR EXISTS(SELECT 1 FROM public.meta_ads_read_grants WHERE client_id <> tenant AND ad_account_id=account AND revoked_at IS NULL);
$$;
CREATE FUNCTION public.meta_ads_authorization_current(tenant uuid,key_id uuid,account text) RETURNS boolean
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
CREATE FUNCTION public.meta_ads_discovery_current(tenant uuid,conn_id uuid,principal uuid,expected_version timestamptz) RETURNS boolean
LANGUAGE sql STABLE SET search_path = '' AS $$
 SELECT EXISTS(
   SELECT 1 FROM public.platform_oauth_connections c
   JOIN public.meta_ads_ai_pilot_entitlements e ON e.client_id=c.client_id AND e.revision=c.entitlement_revision
   WHERE c.id=conn_id AND c.client_id=tenant AND c.authorizing_principal_id=principal AND c.updated_at=expected_version
     AND c.purpose='meta_ads_read' AND c.provider='meta' AND c.status='active' AND c.token_expiry>now()
     AND 'ads_read'=ANY(c.scopes) AND e.status='active' AND e.starts_at<=now() AND (e.expires_at IS NULL OR e.expires_at>now())
 );
$$;
CREATE FUNCTION public.meta_ads_binding_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
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
CREATE TRIGGER meta_ads_grant_guard BEFORE INSERT OR UPDATE ON public.meta_ads_read_grants FOR EACH ROW EXECUTE FUNCTION public.meta_ads_binding_guard();
CREATE TRIGGER meta_ads_registry_guard BEFORE INSERT OR UPDATE OF client_id,ad_account_id ON public.client_meta_ad_accounts FOR EACH ROW EXECUTE FUNCTION public.meta_ads_binding_guard();
CREATE TRIGGER meta_ads_legacy_guard BEFORE INSERT OR UPDATE OF meta_ad_account_id ON public.clients FOR EACH ROW EXECUTE FUNCTION public.meta_ads_binding_guard();
CREATE FUNCTION public.meta_ads_connection_entitlement_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
 IF NEW.purpose='meta_ads_read' THEN
   IF TG_OP='UPDATE' AND NEW.authorizing_principal_id IS DISTINCT FROM OLD.authorizing_principal_id THEN
     RAISE EXCEPTION 'connection owner is immutable' USING ERRCODE='23514';
   END IF;
   IF NEW.status='active' AND NOT public.meta_ads_active_entitlement(NEW.client_id,NEW.entitlement_revision) THEN
     RAISE EXCEPTION 'inactive pilot entitlement' USING ERRCODE='23514';
   END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER meta_ads_connection_entitlement BEFORE INSERT OR UPDATE ON public.platform_oauth_connections
  FOR EACH ROW EXECUTE FUNCTION public.meta_ads_connection_entitlement_guard();
CREATE FUNCTION public.meta_ads_reserve_read(tenant uuid) RETURNS boolean LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE allowed boolean;
BEGIN
 INSERT INTO public.meta_ads_read_limits(client_id,calls) VALUES(tenant,1)
 ON CONFLICT(client_id) DO UPDATE SET
 calls=CASE WHEN meta_ads_read_limits.window_start < now()-interval '1 minute' THEN 1 ELSE meta_ads_read_limits.calls+1 END,
 window_start=CASE WHEN meta_ads_read_limits.window_start < now()-interval '1 minute' THEN now() ELSE meta_ads_read_limits.window_start END
 RETURNING calls<=30 INTO allowed;
 RETURN allowed;
END; $$;
REVOKE ALL ON FUNCTION public.meta_ads_registered_match(text,text), public.meta_ads_account_conflict(uuid,text), public.meta_ads_authorization_current(uuid,uuid,text), public.meta_ads_discovery_current(uuid,uuid,uuid,timestamptz), public.meta_ads_binding_guard(), public.meta_ads_reserve_read(uuid), public.meta_ads_entitlement_revision_guard(), public.meta_ads_active_entitlement(uuid,uuid), public.meta_ads_connection_entitlement_guard() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.meta_ads_registered_match(text,text), public.meta_ads_account_conflict(uuid,text), public.meta_ads_authorization_current(uuid,uuid,text), public.meta_ads_discovery_current(uuid,uuid,uuid,timestamptz), public.meta_ads_binding_guard(), public.meta_ads_reserve_read(uuid), public.meta_ads_entitlement_revision_guard(), public.meta_ads_active_entitlement(uuid,uuid), public.meta_ads_connection_entitlement_guard() TO service_role;
-- Reconsent never resurrects keys/grants issued before disconnect or token replacement.
CREATE FUNCTION public.meta_ads_connection_changed() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
 IF OLD.purpose='meta_ads_read' AND (OLD.access_token_enc IS DISTINCT FROM NEW.access_token_enc OR OLD.status IS DISTINCT FROM NEW.status
    OR OLD.entitlement_revision IS DISTINCT FROM NEW.entitlement_revision) THEN
   UPDATE public.meta_ads_binding_lock SET revision=revision+1 WHERE id=true;
   UPDATE public.meta_ads_read_grants SET revoked_at=now() WHERE connection_id=OLD.id AND revoked_at IS NULL;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER meta_ads_connection_invalidate AFTER UPDATE OF access_token_enc,status,entitlement_revision ON public.platform_oauth_connections FOR EACH ROW EXECUTE FUNCTION public.meta_ads_connection_changed();
REVOKE ALL ON FUNCTION public.meta_ads_connection_changed() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.meta_ads_connection_changed() TO service_role;
-- Reuse the platform control-plane and tool audit stores; no parallel audit infrastructure.
ALTER TABLE public.client_binding_audit DROP CONSTRAINT client_binding_audit_binding_kind_check;
ALTER TABLE public.client_binding_audit ADD CONSTRAINT client_binding_audit_binding_kind_check CHECK(binding_kind IN ('meta_ad_account','facebook_page','meta_ads_read'));
ALTER TABLE public.mcp_access_log ADD COLUMN resource_id text CHECK(char_length(resource_id)<=64);
