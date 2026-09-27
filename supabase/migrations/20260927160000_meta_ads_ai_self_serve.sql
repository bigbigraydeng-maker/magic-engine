-- Magic Bridge opening to self-serve customers, PR-1 (self-serve activation + anti-abuse quotas).
-- Design: docs/specs/2026-09-27-magic-bridge-self-serve-open-design.md §2 PR-1 and §8.2–§8.3.
-- Service-role only. Apply only after explicit PM approval.
--
-- 1. Entitlements get a `source`: 'ops' (opened by us — existing rows, and the testers who may
--    connect Facebook while Meta review is pending) or 'self_serve' (opened by the customer).
-- 2. Jobs remember a one-way key of the Facebook user who ran them (sha256 of the connection's
--    account id at reserve time), so per-person monthly usage survives data deletion (which
--    replaces the account id on the connection) and client deletion does not matter for new rows.
-- 3. Monthly caps per Facebook user, per ad account and for the whole platform (self-serve only)
--    live in a small config table so ops can change them without a release.
-- 4. A blocklist (Facebook user key / ad account id) checked when reserving an analysis
--    (the app also checks it at OAuth callback and at bind).
-- 5. meta_ads_self_serve_activate(): a self-serve member opens (or, once expired, renews) their
--    own client's free 90-day entitlement. Paused / revoked / ops-opened entitlements cannot be
--    reopened this way.
-- 6. meta_ads_reserve_sponsored_analysis() is replaced: same checks as before, plus blocklist and
--    the three self-serve caps, evaluated under transaction advisory locks taken in a fixed order
--    (platform → ad account → Facebook user) so two reservations cannot both pass a check.

ALTER TABLE public.meta_ads_ai_pilot_entitlements
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'ops'
  CHECK (source IN ('ops', 'self_serve'));

ALTER TABLE public.meta_ads_ai_analysis_jobs
  ADD COLUMN IF NOT EXISTS facebook_user_key text
  CHECK (facebook_user_key IS NULL OR facebook_user_key ~ '^[0-9a-f]{64}$');
CREATE INDEX IF NOT EXISTS meta_ads_ai_analysis_jobs_fb_user_period_idx
  ON public.meta_ads_ai_analysis_jobs (facebook_user_key, period_key);
CREATE INDEX IF NOT EXISTS meta_ads_ai_analysis_jobs_account_period_idx
  ON public.meta_ads_ai_analysis_jobs (ad_account_id, period_key);

CREATE TABLE IF NOT EXISTS public.meta_ads_ai_quota_config (
  scope text PRIMARY KEY CHECK (scope IN ('facebook_user', 'ad_account', 'platform')),
  cap_usd numeric(10,6) NOT NULL CHECK (cap_usd >= 0 AND cap_usd <= 1000),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- PM 2026-09-27: US$1 per Facebook user and per ad account each month, US$30 for the whole platform.
INSERT INTO public.meta_ads_ai_quota_config (scope, cap_usd) VALUES
  ('facebook_user', 1.0), ('ad_account', 1.0), ('platform', 30.0)
ON CONFLICT (scope) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.meta_ads_ai_blocklist (
  kind text NOT NULL CHECK (kind IN ('facebook_user', 'ad_account')),
  key text NOT NULL CHECK (
    (kind = 'facebook_user' AND key ~ '^[0-9a-f]{64}$')
    OR (kind = 'ad_account' AND key ~ '^act_[1-9][0-9]{9,24}$')
  ),
  reason text NOT NULL CHECK (length(reason) BETWEEN 1 AND 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (kind, key)
);

ALTER TABLE public.meta_ads_ai_quota_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meta_ads_ai_blocklist ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS service_role_full ON public.meta_ads_ai_quota_config;
CREATE POLICY service_role_full ON public.meta_ads_ai_quota_config
  FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS service_role_full ON public.meta_ads_ai_blocklist;
CREATE POLICY service_role_full ON public.meta_ads_ai_blocklist
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.meta_ads_ai_quota_config, public.meta_ads_ai_blocklist FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.meta_ads_ai_quota_config, public.meta_ads_ai_blocklist TO service_role;

-- The one-way key of a Facebook user as stored on a read connection ('ads_user:<id>').
CREATE OR REPLACE FUNCTION public.meta_ads_facebook_user_key(account text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT encode(sha256(convert_to('meta-ads-user:' || account, 'UTF8')), 'hex');
$$;

CREATE OR REPLACE FUNCTION public.meta_ads_is_blocked(p_kind text, p_key text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.meta_ads_ai_blocklist b WHERE b.kind = p_kind AND b.key = p_key);
$$;

CREATE OR REPLACE FUNCTION public.meta_ads_self_serve_activate(tenant uuid, member_email text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_entitlement public.meta_ads_ai_pilot_entitlements%ROWTYPE;
  v_email text := lower(btrim(coalesce(member_email, '')));
BEGIN
  IF v_email = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_allowed');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.clients c WHERE c.id = tenant AND c.source = 'self_serve') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_allowed');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.client_portal_users u
     WHERE u.client_id = tenant AND lower(u.email) = v_email AND u.access_type = 'self_serve'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_allowed');
  END IF;

  SELECT * INTO v_entitlement FROM public.meta_ads_ai_pilot_entitlements e
   WHERE e.client_id = tenant FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.meta_ads_ai_pilot_entitlements
      (client_id, status, starts_at, expires_at, approved_by_email, sponsored_analysis_enabled, source)
    VALUES (tenant, 'active', now(), now() + interval '90 days', 'self_serve:' || v_email, true, 'self_serve');
    RETURN jsonb_build_object('ok', true, 'result', 'activated');
  END IF;

  IF v_entitlement.source <> 'self_serve' OR v_entitlement.status <> 'active' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_allowed');
  END IF;
  IF v_entitlement.expires_at IS NOT NULL AND v_entitlement.expires_at <= now() THEN
    -- Renewal: the revision trigger rotates the revision, so old OAuth/grants never come back.
    UPDATE public.meta_ads_ai_pilot_entitlements
       SET starts_at = now(), expires_at = now() + interval '90 days', sponsored_analysis_enabled = true
     WHERE client_id = tenant;
    RETURN jsonb_build_object('ok', true, 'result', 'renewed');
  END IF;
  RETURN jsonb_build_object('ok', true, 'result', 'already_active');
END;
$$;

-- Sum of money a set of jobs holds this period: running jobs hold their reservation,
-- finished jobs their actual cost.
CREATE OR REPLACE FUNCTION public.meta_ads_quota_used(p_period text, p_scope text, p_key text)
RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(sum(CASE WHEN j.status = 'running' THEN j.reserved_usd ELSE coalesce(j.actual_cost_usd, 0) END), 0)
    FROM public.meta_ads_ai_analysis_jobs j
    JOIN public.meta_ads_ai_pilot_entitlements e ON e.client_id = j.client_id
   WHERE j.period_key = p_period
     AND e.source = 'self_serve'
     AND CASE p_scope
           WHEN 'platform' THEN true
           WHEN 'ad_account' THEN j.ad_account_id = p_key
           WHEN 'facebook_user' THEN j.facebook_user_key = p_key
           ELSE false
         END;
$$;

CREATE OR REPLACE FUNCTION public.meta_ads_quota_check(p_period text, p_account text, p_fb_key text, p_reserve numeric)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_cap numeric;
BEGIN
  -- Fixed lock order: platform → ad account → Facebook user.
  PERFORM pg_advisory_xact_lock(hashtextextended('meta_ads_quota:platform:' || p_period, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended('meta_ads_quota:ad_account:' || p_period || ':' || p_account, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended('meta_ads_quota:facebook_user:' || p_period || ':' || p_fb_key, 0));

  SELECT cap_usd INTO v_cap FROM public.meta_ads_ai_quota_config WHERE scope = 'platform';
  IF v_cap IS NULL OR public.meta_ads_quota_used(p_period, 'platform', '') + p_reserve > v_cap THEN
    RETURN 'platform_quota_reached';
  END IF;
  SELECT cap_usd INTO v_cap FROM public.meta_ads_ai_quota_config WHERE scope = 'ad_account';
  IF v_cap IS NULL OR public.meta_ads_quota_used(p_period, 'ad_account', p_account) + p_reserve > v_cap THEN
    RETURN 'ad_account_quota_reached';
  END IF;
  SELECT cap_usd INTO v_cap FROM public.meta_ads_ai_quota_config WHERE scope = 'facebook_user';
  IF v_cap IS NULL OR public.meta_ads_quota_used(p_period, 'facebook_user', p_fb_key) + p_reserve > v_cap THEN
    RETURN 'facebook_user_quota_reached';
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.meta_ads_reserve_sponsored_analysis(
  tenant uuid,
  principal uuid,
  grant_id uuid,
  request_key text,
  since_day date,
  until_day date
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_entitlement public.meta_ads_ai_pilot_entitlements%ROWTYPE;
  v_grant public.meta_ads_read_grants%ROWTYPE;
  v_period text := to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM');
  v_budget public.meta_ads_ai_sponsored_budgets%ROWTYPE;
  v_job public.meta_ads_ai_analysis_jobs%ROWTYPE;
  v_connection_version timestamptz;
  v_account_id text;
  v_fb_key text;
  v_quota text;
BEGIN
  SELECT * INTO v_entitlement
    FROM public.meta_ads_ai_pilot_entitlements e
   WHERE e.client_id = tenant
   FOR UPDATE;
  IF NOT FOUND OR v_entitlement.status <> 'active'
     OR v_entitlement.starts_at > now()
     OR (v_entitlement.expires_at IS NOT NULL AND v_entitlement.expires_at <= now())
     OR NOT v_entitlement.sponsored_analysis_enabled THEN
    RETURN jsonb_build_object('reserved', false, 'reason', 'sponsored_analysis_unavailable');
  END IF;

  SELECT g.* INTO v_grant
    FROM public.meta_ads_read_grants g
    JOIN public.platform_oauth_connections c
      ON c.id = g.connection_id AND c.client_id = g.client_id
   WHERE g.id = grant_id AND g.client_id = tenant AND g.principal_id = principal
     AND g.revoked_at IS NULL AND g.entitlement_revision = v_entitlement.revision
     AND c.provider = 'meta' AND c.purpose = 'meta_ads_read' AND c.status = 'active'
     AND c.scopes @> ARRAY['ads_read']::text[]
     AND c.authorizing_principal_id = principal
     AND c.entitlement_revision = v_entitlement.revision
     AND c.token_expiry > now()
     AND NOT public.meta_ads_account_conflict(tenant, g.ad_account_id)
   FOR UPDATE OF g, c;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('reserved', false, 'reason', 'authorization_changed');
  END IF;

  SELECT c.updated_at, c.account_id INTO v_connection_version, v_account_id
    FROM public.platform_oauth_connections c
   WHERE c.id = v_grant.connection_id;
  v_fb_key := public.meta_ads_facebook_user_key(v_account_id);

  IF public.meta_ads_is_blocked('facebook_user', v_fb_key) OR public.meta_ads_is_blocked('ad_account', v_grant.ad_account_id) THEN
    RETURN jsonb_build_object('reserved', false, 'reason', 'blocked');
  END IF;

  SELECT * INTO v_job
    FROM public.meta_ads_ai_analysis_jobs j
   WHERE j.client_id = tenant AND j.idempotency_key = request_key;
  IF FOUND THEN
    IF v_job.status = 'running' AND v_job.created_at <= now() - interval '15 minutes' THEN
      UPDATE public.meta_ads_ai_sponsored_budgets
         SET reserved_usd = reserved_usd - v_job.reserved_usd,
             spent_usd = spent_usd + v_job.reserved_usd,
             updated_at = now()
       WHERE client_id = tenant AND period_key = v_job.period_key
         AND reserved_usd >= v_job.reserved_usd;
      IF NOT FOUND THEN
        RETURN jsonb_build_object('reserved', false, 'reason', 'budget_state_invalid');
      END IF;
      UPDATE public.meta_ads_ai_analysis_jobs
         SET status = 'failed', actual_cost_usd = reserved_usd, error_code = 'stale_running', completed_at = now(),
             idempotency_key = idempotency_key || ':failed:' || id::text
       WHERE id = v_job.id;
    ELSIF v_job.status <> 'failed' THEN
      RETURN jsonb_build_object('reserved', true, 'idempotent', true, 'job_id', v_job.id,
        'status', v_job.status, 'reserve_usd', v_job.reserved_usd);
    ELSE
      UPDATE public.meta_ads_ai_analysis_jobs
         SET idempotency_key = idempotency_key || ':failed:' || id::text
       WHERE id = v_job.id;
    END IF;
  END IF;

  IF v_entitlement.source = 'self_serve' THEN
    v_quota := public.meta_ads_quota_check(v_period, v_grant.ad_account_id, v_fb_key,
      v_entitlement.sponsored_analysis_reserve_usd);
    IF v_quota IS NOT NULL THEN
      RETURN jsonb_build_object('reserved', false, 'reason', v_quota);
    END IF;
  END IF;

  INSERT INTO public.meta_ads_ai_sponsored_budgets (client_id, period_key, cap_usd)
  VALUES (tenant, v_period, v_entitlement.sponsored_monthly_cap_usd)
  ON CONFLICT (client_id, period_key) DO NOTHING;

  SELECT * INTO v_budget
    FROM public.meta_ads_ai_sponsored_budgets b
   WHERE b.client_id = tenant AND b.period_key = v_period
   FOR UPDATE;
  IF v_budget.cap_usd <> v_entitlement.sponsored_monthly_cap_usd THEN
    IF v_budget.reserved_usd + v_budget.spent_usd > v_entitlement.sponsored_monthly_cap_usd THEN
      RETURN jsonb_build_object('reserved', false, 'reason', 'sponsored_budget_exhausted');
    END IF;
    UPDATE public.meta_ads_ai_sponsored_budgets
       SET cap_usd = v_entitlement.sponsored_monthly_cap_usd, updated_at = now()
     WHERE client_id = tenant AND period_key = v_period
       AND reserved_usd + spent_usd <= v_entitlement.sponsored_monthly_cap_usd;
    SELECT * INTO v_budget FROM public.meta_ads_ai_sponsored_budgets
     WHERE client_id = tenant AND period_key = v_period;
  END IF;
  IF v_budget.reserved_usd + v_budget.spent_usd + v_entitlement.sponsored_analysis_reserve_usd > v_budget.cap_usd THEN
    RETURN jsonb_build_object('reserved', false, 'reason', 'sponsored_budget_exhausted');
  END IF;

  UPDATE public.meta_ads_ai_sponsored_budgets
     SET reserved_usd = reserved_usd + v_entitlement.sponsored_analysis_reserve_usd, updated_at = now()
   WHERE client_id = tenant AND period_key = v_period;
  INSERT INTO public.meta_ads_ai_analysis_jobs (
    client_id, principal_id, grant_id, grant_revision, connection_version, entitlement_revision, ad_account_id,
    idempotency_key, period_key, window_since, window_until, status, reserved_usd, facebook_user_key
  ) VALUES (
    tenant, principal, grant_id, v_grant.revision, v_connection_version, v_entitlement.revision, v_grant.ad_account_id,
    request_key, v_period, since_day, until_day, 'running', v_entitlement.sponsored_analysis_reserve_usd, v_fb_key
  ) RETURNING * INTO v_job;
  RETURN jsonb_build_object('reserved', true, 'idempotent', false, 'job_id', v_job.id,
    'status', v_job.status, 'reserve_usd', v_job.reserved_usd);
END;
$$;

REVOKE ALL ON FUNCTION public.meta_ads_facebook_user_key(text),
  public.meta_ads_is_blocked(text, text),
  public.meta_ads_self_serve_activate(uuid, text),
  public.meta_ads_quota_used(text, text, text),
  public.meta_ads_quota_check(text, text, text, numeric),
  public.meta_ads_reserve_sponsored_analysis(uuid, uuid, uuid, text, date, date)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.meta_ads_facebook_user_key(text),
  public.meta_ads_is_blocked(text, text),
  public.meta_ads_self_serve_activate(uuid, text),
  public.meta_ads_quota_used(text, text, text),
  public.meta_ads_quota_check(text, text, text, numeric),
  public.meta_ads_reserve_sponsored_analysis(uuid, uuid, uuid, text, date, date)
  TO service_role;
