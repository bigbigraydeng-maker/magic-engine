ALTER TABLE public.meta_ads_ai_pilot_entitlements
  ADD COLUMN IF NOT EXISTS sponsored_analysis_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sponsored_monthly_cap_usd numeric(10,6) NOT NULL DEFAULT 1.000000
    CHECK (sponsored_monthly_cap_usd >= 0 AND sponsored_monthly_cap_usd <= 25),
  ADD COLUMN IF NOT EXISTS sponsored_analysis_reserve_usd numeric(10,6) NOT NULL DEFAULT 0.120000
    CHECK (sponsored_analysis_reserve_usd >= 0.120000 AND sponsored_analysis_reserve_usd <= 1);

CREATE TABLE IF NOT EXISTS public.meta_ads_ai_sponsored_budgets (
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  period_key text NOT NULL CHECK (period_key ~ '^\d{4}-\d{2}$'),
  cap_usd numeric(10,6) NOT NULL CHECK (cap_usd >= 0 AND cap_usd <= 25),
  reserved_usd numeric(10,6) NOT NULL DEFAULT 0 CHECK (reserved_usd >= 0),
  spent_usd numeric(10,6) NOT NULL DEFAULT 0 CHECK (spent_usd >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (client_id, period_key),
  CHECK (reserved_usd + spent_usd <= cap_usd)
);

CREATE TABLE IF NOT EXISTS public.meta_ads_ai_analysis_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  principal_id uuid NOT NULL,
  grant_id uuid NOT NULL REFERENCES public.meta_ads_read_grants(id) ON DELETE RESTRICT,
  grant_revision uuid NOT NULL,
  connection_version timestamptz NOT NULL,
  entitlement_revision uuid NOT NULL,
  ad_account_id text NOT NULL CHECK (ad_account_id ~ '^act_[1-9][0-9]{9,24}$'),
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 32 AND 200),
  period_key text NOT NULL CHECK (period_key ~ '^\d{4}-\d{2}$'),
  window_since date NOT NULL,
  window_until date NOT NULL CHECK (window_until >= window_since),
  status text NOT NULL CHECK (status IN ('running','completed','no_data','failed')),
  reserved_usd numeric(10,6) NOT NULL CHECK (reserved_usd > 0),
  actual_cost_usd numeric(10,6) CHECK (actual_cost_usd >= 0),
  input_tokens integer CHECK (input_tokens >= 0),
  output_tokens integer CHECK (output_tokens >= 0),
  model text,
  evidence jsonb,
  report_markdown text,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (client_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS meta_ads_ai_analysis_jobs_owner_idx
  ON public.meta_ads_ai_analysis_jobs (client_id, principal_id, created_at DESC);

ALTER TABLE public.meta_ads_ai_sponsored_budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meta_ads_ai_analysis_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS service_role_full ON public.meta_ads_ai_sponsored_budgets;
CREATE POLICY service_role_full ON public.meta_ads_ai_sponsored_budgets
  FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS service_role_full ON public.meta_ads_ai_analysis_jobs;
CREATE POLICY service_role_full ON public.meta_ads_ai_analysis_jobs
  FOR ALL TO service_role USING (true) WITH CHECK (true);

REVOKE ALL ON public.meta_ads_ai_sponsored_budgets, public.meta_ads_ai_analysis_jobs
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.meta_ads_ai_sponsored_budgets, public.meta_ads_ai_analysis_jobs TO service_role;

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

  SELECT c.updated_at INTO v_connection_version
    FROM public.platform_oauth_connections c
   WHERE c.id = v_grant.connection_id;

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
    idempotency_key, period_key, window_since, window_until, status, reserved_usd
  ) VALUES (
    tenant, principal, grant_id, v_grant.revision, v_connection_version, v_entitlement.revision, v_grant.ad_account_id,
    request_key, v_period, since_day, until_day, 'running', v_entitlement.sponsored_analysis_reserve_usd
  ) RETURNING * INTO v_job;
  RETURN jsonb_build_object('reserved', true, 'idempotent', false, 'job_id', v_job.id,
    'status', v_job.status, 'reserve_usd', v_job.reserved_usd);
END;
$$;

CREATE OR REPLACE FUNCTION public.meta_ads_authorize_sponsored_analysis(
  tenant uuid,
  principal uuid,
  job uuid
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_job public.meta_ads_ai_analysis_jobs%ROWTYPE;
  v_authorized boolean;
BEGIN
  SELECT * INTO v_job
    FROM public.meta_ads_ai_analysis_jobs j
   WHERE j.id = job AND j.client_id = tenant AND j.principal_id = principal
     AND j.status = 'running'
   FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;

  -- This is the linearization point immediately before model dispatch. If a
  -- revoke already holds a row lock we wait and observe its new state; if this
  -- function locks first, the dispatch was authorized before that revoke.
  SELECT true INTO v_authorized
    FROM public.meta_ads_ai_pilot_entitlements e
    JOIN public.meta_ads_read_grants g ON g.client_id = e.client_id
    JOIN public.platform_oauth_connections c ON c.id = g.connection_id AND c.client_id = g.client_id
   WHERE e.client_id = tenant AND e.status = 'active' AND e.starts_at <= now()
     AND (e.expires_at IS NULL OR e.expires_at > now()) AND e.sponsored_analysis_enabled
     AND e.revision = v_job.entitlement_revision
     AND g.id = v_job.grant_id AND g.principal_id = principal AND g.revoked_at IS NULL
     AND g.revision = v_job.grant_revision AND g.entitlement_revision = e.revision AND g.ad_account_id = v_job.ad_account_id
     AND c.provider = 'meta' AND c.purpose = 'meta_ads_read' AND c.status = 'active'
     AND c.authorizing_principal_id = principal AND c.entitlement_revision = e.revision
     AND c.updated_at = v_job.connection_version
     AND c.scopes @> ARRAY['ads_read']::text[] AND c.token_expiry > now()
     AND NOT public.meta_ads_account_conflict(tenant, g.ad_account_id)
   FOR UPDATE OF e, g, c;
  RETURN v_authorized IS TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.meta_ads_finish_sponsored_analysis(
  tenant uuid,
  principal uuid,
  job uuid,
  final_status text,
  charged_usd numeric,
  evidence_payload jsonb DEFAULT NULL,
  report_body text DEFAULT NULL,
  model_name text DEFAULT NULL,
  input_token_count integer DEFAULT NULL,
  output_token_count integer DEFAULT NULL,
  failure_code text DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_job public.meta_ads_ai_analysis_jobs%ROWTYPE;
  v_charge numeric(10,6);
  v_authorized boolean;
BEGIN
  IF final_status NOT IN ('completed','no_data','failed') OR charged_usd < 0 THEN RETURN false; END IF;
  SELECT * INTO v_job FROM public.meta_ads_ai_analysis_jobs j
   WHERE j.id = job AND j.client_id = tenant AND j.principal_id = principal
   FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF v_job.status <> 'running' THEN RETURN true; END IF;
  IF charged_usd > v_job.reserved_usd THEN RETURN false; END IF;
  v_charge := charged_usd;
  SELECT true INTO v_authorized
    FROM public.meta_ads_ai_pilot_entitlements e
    JOIN public.meta_ads_read_grants g ON g.client_id = e.client_id
    JOIN public.platform_oauth_connections c ON c.id = g.connection_id AND c.client_id = g.client_id
   WHERE e.client_id = tenant AND e.status = 'active' AND e.starts_at <= now()
     AND (e.expires_at IS NULL OR e.expires_at > now()) AND e.sponsored_analysis_enabled
     AND e.revision = v_job.entitlement_revision
     AND g.id = v_job.grant_id AND g.principal_id = principal AND g.revoked_at IS NULL
     AND g.revision = v_job.grant_revision AND g.entitlement_revision = e.revision AND g.ad_account_id = v_job.ad_account_id
     AND c.provider = 'meta' AND c.purpose = 'meta_ads_read' AND c.status = 'active'
     AND c.authorizing_principal_id = principal AND c.entitlement_revision = e.revision
     AND c.updated_at = v_job.connection_version
     AND c.scopes @> ARRAY['ads_read']::text[] AND c.token_expiry > now()
     AND NOT public.meta_ads_account_conflict(tenant, g.ad_account_id)
   FOR UPDATE OF e, g, c;
  IF v_authorized IS DISTINCT FROM true THEN
    final_status := 'failed';
    evidence_payload := NULL;
    report_body := NULL;
    failure_code := 'authorization_changed';
  END IF;
  UPDATE public.meta_ads_ai_sponsored_budgets
     SET reserved_usd = reserved_usd - v_job.reserved_usd,
         spent_usd = spent_usd + v_charge,
         updated_at = now()
   WHERE client_id = tenant AND period_key = v_job.period_key
     AND reserved_usd >= v_job.reserved_usd;
  IF NOT FOUND THEN RETURN false; END IF;
  UPDATE public.meta_ads_ai_analysis_jobs SET
    status = final_status,
    actual_cost_usd = v_charge,
    evidence = evidence_payload,
    report_markdown = report_body,
    model = model_name,
    input_tokens = input_token_count,
    output_tokens = output_token_count,
    error_code = failure_code,
    completed_at = now()
   WHERE id = job;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.meta_ads_reserve_sponsored_analysis(uuid,uuid,uuid,text,date,date),
  public.meta_ads_authorize_sponsored_analysis(uuid,uuid,uuid),
  public.meta_ads_finish_sponsored_analysis(uuid,uuid,uuid,text,numeric,jsonb,text,text,integer,integer,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.meta_ads_reserve_sponsored_analysis(uuid,uuid,uuid,text,date,date),
  public.meta_ads_authorize_sponsored_analysis(uuid,uuid,uuid),
  public.meta_ads_finish_sponsored_analysis(uuid,uuid,uuid,text,numeric,jsonb,text,text,integer,integer,text)
  TO service_role;
