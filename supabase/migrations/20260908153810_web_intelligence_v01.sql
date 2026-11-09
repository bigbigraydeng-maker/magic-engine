-- #1497: additive, disabled until configured. No client seeds or production enablement.
CREATE TABLE public.web_intelligence_settings (
  client_id uuid PRIMARY KEY REFERENCES public.clients(id),
  enabled boolean NOT NULL DEFAULT false,
  entitled boolean NOT NULL DEFAULT false,
  entitlement_price numeric NOT NULL DEFAULT 499 CHECK (entitlement_price = 499),
  entitlement_currency text CHECK (entitlement_currency IN ('NZD','AUD','USD')),
  target_nzd numeric NOT NULL DEFAULT 30 CHECK (target_nzd > 0 AND target_nzd <= 30),
  hard_stop_nzd numeric NOT NULL DEFAULT 50 CHECK (hard_stop_nzd >= target_nzd AND hard_stop_nzd <= 50),
  usd_to_nzd numeric NOT NULL CHECK (usd_to_nzd > 0 AND usd_to_nzd < 10),
  fx_as_of date NOT NULL,
  actor_build text NOT NULL CHECK (actor_build ~ '^[0-9]+\.[0-9]+\.[0-9]+$'),
  capture_limit_usd numeric NOT NULL DEFAULT 0.1 CHECK (capture_limit_usd >= 0.01 AND capture_limit_usd <= 1),
  -- Conservative reservation for reads/storage/orchestration; retained, not reported as measured spend.
  overhead_nzd numeric NOT NULL DEFAULT 0.02 CHECK (overhead_nzd >= 0.02 AND overhead_nzd <= 1),
  context text NOT NULL DEFAULT '' CHECK (length(context) <= 2000),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.competitor_monitoring_metadata (
  client_id uuid NOT NULL REFERENCES public.clients(id),
  domain text NOT NULL,
  tier text NOT NULL DEFAULT 'watch' CHECK (tier IN ('core','secondary','benchmark','watch')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','emerging','archive')),
  sources text[] NOT NULL DEFAULT '{}',
  tags text[] NOT NULL DEFAULT '{}',
  urls text[] NOT NULL DEFAULT '{}',
  interval_hours integer NOT NULL DEFAULT 168 CHECK (interval_hours BETWEEN 24 AND 720),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (client_id, domain)
);
COMMENT ON TABLE public.competitor_monitoring_metadata IS 'Annotations only: eligible identities always come from the existing competitor resolver or baseline_domains, never from this table alone.';
CREATE TABLE public.web_intelligence_runs (
  id uuid PRIMARY KEY,
  client_id uuid NOT NULL REFERENCES public.clients(id),
  domain text NOT NULL,
  url text NOT NULL,
  period_key text NOT NULL,
  status text NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved','capturing','captured','understanding','complete','failed','reconciliation')),
  capture_claimed boolean NOT NULL DEFAULT false,
  interpretation_claimed boolean NOT NULL DEFAULT false,
  provider_run_id text,
  provider_dataset_id text,
  provider_status text,
  capture_cost_usd numeric CHECK (capture_cost_usd >= 0 AND capture_cost_usd < 'Infinity'::numeric),
  interpretation_cost_usd numeric CHECK (interpretation_cost_usd >= 0 AND interpretation_cost_usd < 'Infinity'::numeric),
  reserved_nzd numeric NOT NULL CHECK (reserved_nzd > 0 AND reserved_nzd < 'Infinity'::numeric),
  accounted_nzd numeric CHECK (accounted_nzd >= 0 AND accounted_nzd < 'Infinity'::numeric),
  fx_rate numeric NOT NULL CHECK (fx_rate > 0 AND fx_rate < 'Infinity'::numeric),
  capture_limit_usd numeric NOT NULL CHECK (capture_limit_usd >= 0.01 AND capture_limit_usd <= 1),
  overhead_nzd numeric NOT NULL CHECK (overhead_nzd >= 0.02 AND overhead_nzd <= 1),
  actor_build text NOT NULL,
  error_code text,
  no_execute boolean NOT NULL DEFAULT true CHECK (no_execute),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(id,client_id)
);
CREATE INDEX web_intelligence_runs_budget ON public.web_intelligence_runs(client_id,period_key);
CREATE INDEX web_intelligence_runs_target ON public.web_intelligence_runs(client_id,domain,url,created_at DESC);
CREATE TABLE public.market_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id),
  run_id uuid NOT NULL UNIQUE,
  domain text NOT NULL,
  url text NOT NULL,
  title text NOT NULL,
  content text NOT NULL CHECK (length(content) BETWEEN 80 AND 200000),
  content_hash text NOT NULL,
  collector_version text NOT NULL DEFAULT 'website-v1',
  captured_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(id,client_id),
  FOREIGN KEY(run_id,client_id) REFERENCES public.web_intelligence_runs(id,client_id)
);
CREATE INDEX market_snapshots_target ON public.market_snapshots(client_id,domain,url,captured_at DESC);
CREATE TABLE public.market_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id),
  snapshot_id uuid NOT NULL UNIQUE,
  source_url text NOT NULL,
  excerpt text NOT NULL,
  content_hash text NOT NULL,
  observed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(id,client_id),
  FOREIGN KEY(snapshot_id,client_id) REFERENCES public.market_snapshots(id,client_id)
);
CREATE TABLE public.market_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id),
  run_id uuid NOT NULL UNIQUE,
  domain text NOT NULL,
  kind text NOT NULL DEFAULT 'website_content_changed',
  before_evidence_id uuid NOT NULL,
  after_evidence_id uuid NOT NULL,
  interpretation_status text NOT NULL DEFAULT 'pending' CHECK (interpretation_status IN ('pending','complete','failed')),
  classification text CHECK (classification IN ('threat','opportunity','ignore')),
  interpretation jsonb,
  recommended_action text,
  model text,
  prompt_version text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(id,client_id),
  FOREIGN KEY(run_id,client_id) REFERENCES public.web_intelligence_runs(id,client_id),
  FOREIGN KEY(before_evidence_id,client_id) REFERENCES public.market_evidence(id,client_id),
  FOREIGN KEY(after_evidence_id,client_id) REFERENCES public.market_evidence(id,client_id),
  CHECK (interpretation_status <> 'complete' OR (classification IS NOT NULL AND interpretation IS NOT NULL AND recommended_action IS NOT NULL))
);
-- One client lock covers all entry points, periods and unsettled provider operations.
CREATE FUNCTION public.web_intelligence_reserve(p_id uuid,p_client_id uuid,p_domain text,p_url text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE s web_intelligence_settings; r web_intelligence_runs; used numeric; reserve_nzd numeric; period text; is_core boolean;
BEGIN
  IF p_id IS NULL OR p_client_id IS NULL OR p_domain IS NULL OR p_domain='' OR p_url IS NULL OR p_url='' THEN RAISE EXCEPTION 'invalid_identity'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_client_id::text,1497));
  SELECT * INTO r FROM web_intelligence_runs WHERE id=p_id;
  IF FOUND THEN
    IF r.client_id IS DISTINCT FROM p_client_id OR r.domain IS DISTINCT FROM p_domain OR r.url IS DISTINCT FROM p_url THEN RAISE EXCEPTION 'request_identity_mismatch'; END IF;
    RETURN to_jsonb(r);
  END IF;
  SELECT * INTO s FROM web_intelligence_settings WHERE client_id=p_client_id FOR UPDATE;
  IF NOT FOUND OR NOT s.enabled OR NOT s.entitled THEN RAISE EXCEPTION 'not_enabled_or_entitled'; END IF;
  IF s.fx_as_of < current_date-31 OR s.fx_as_of > current_date THEN RAISE EXCEPTION 'fx_stale'; END IF;
  IF EXISTS (SELECT 1 FROM web_intelligence_runs WHERE client_id=p_client_id AND status='reconciliation') THEN RAISE EXCEPTION 'unresolved_cost'; END IF;
  IF EXISTS (SELECT 1 FROM competitor_monitoring_metadata WHERE client_id=p_client_id AND domain=p_domain AND status='archive') THEN RAISE EXCEPTION 'archived'; END IF;
  period := to_char(now() AT TIME ZONE 'Pacific/Auckland','YYYY-MM');
  IF EXISTS (SELECT 1 FROM web_intelligence_runs WHERE client_id=p_client_id AND period_key<>period AND accounted_nzd IS NULL) THEN RAISE EXCEPTION 'unresolved_cost'; END IF;
  SELECT * INTO r FROM web_intelligence_runs WHERE client_id=p_client_id AND domain=p_domain AND url=p_url AND status NOT IN ('complete','failed') ORDER BY created_at DESC LIMIT 1;
  IF FOUND THEN RETURN to_jsonb(r); END IF;
  -- US$0.25 bounds one capped interpretation, with no SDK/fallback retries.
  reserve_nzd := (s.capture_limit_usd+0.25)*s.usd_to_nzd+s.overhead_nzd;
  SELECT coalesce(sum(coalesce(accounted_nzd,reserved_nzd)),0) INTO used FROM web_intelligence_runs WHERE client_id=p_client_id AND period_key=period;
  IF used+reserve_nzd>s.hard_stop_nzd THEN RAISE EXCEPTION 'hard_stop'; END IF;
  SELECT EXISTS(SELECT 1 FROM competitor_monitoring_metadata WHERE client_id=p_client_id AND domain=p_domain AND tier='core') INTO is_core;
  IF used+reserve_nzd>s.target_nzd AND NOT is_core THEN RAISE EXCEPTION 'target_pause_non_core'; END IF;
  INSERT INTO web_intelligence_runs(id,client_id,domain,url,period_key,reserved_nzd,fx_rate,capture_limit_usd,overhead_nzd,actor_build)
    VALUES(p_id,p_client_id,p_domain,p_url,period,reserve_nzd,s.usd_to_nzd,s.capture_limit_usd,s.overhead_nzd,s.actor_build) RETURNING * INTO r;
  RETURN to_jsonb(r);
END $$;
-- Transactionally append a valid snapshot and evidence, and create only genuine transitions.
CREATE FUNCTION public.web_intelligence_record_snapshot(p_id uuid,p_client_id uuid,p_url text,p_title text,p_content text,p_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE r web_intelligence_runs; previous market_snapshots; sn market_snapshots; ev uuid; before_ev uuid; signal_id uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_client_id::text,1497));
  SELECT * INTO r FROM web_intelligence_runs WHERE id=p_id AND client_id=p_client_id FOR UPDATE;
  IF NOT FOUND OR r.provider_run_id IS NULL OR r.provider_status IS DISTINCT FROM 'SUCCEEDED' THEN RAISE EXCEPTION 'capture_not_verified'; END IF;
  SELECT * INTO sn FROM market_snapshots WHERE run_id=p_id AND client_id=p_client_id;
  IF FOUND THEN
    SELECT id INTO signal_id FROM market_signals WHERE run_id=p_id AND client_id=p_client_id;
    RETURN jsonb_build_object('snapshot_id',sn.id,'signal_id',signal_id,'state','replayed');
  END IF;
  SELECT * INTO previous FROM market_snapshots WHERE client_id=p_client_id AND domain=r.domain AND url=r.url ORDER BY captured_at DESC,id DESC LIMIT 1;
  INSERT INTO market_snapshots(client_id,run_id,domain,url,title,content,content_hash) VALUES(p_client_id,p_id,r.domain,r.url,p_title,p_content,p_hash) RETURNING * INTO sn;
  INSERT INTO market_evidence(client_id,snapshot_id,source_url,excerpt,content_hash) VALUES(p_client_id,sn.id,p_url,p_content,p_hash) RETURNING id INTO ev;
  IF previous.id IS NOT NULL AND previous.content_hash<>p_hash THEN
    SELECT id INTO before_ev FROM market_evidence WHERE snapshot_id=previous.id AND client_id=p_client_id;
    INSERT INTO market_signals(client_id,run_id,domain,before_evidence_id,after_evidence_id) VALUES(p_client_id,p_id,r.domain,before_ev,ev) RETURNING id INTO signal_id;
  END IF;
  UPDATE web_intelligence_runs SET status='captured',updated_at=now() WHERE id=p_id;
  RETURN jsonb_build_object('snapshot_id',sn.id,'signal_id',signal_id,'state',CASE WHEN previous.id IS NULL THEN 'baseline' WHEN signal_id IS NULL THEN 'unchanged' ELSE 'changed' END);
END $$;
CREATE FUNCTION public.web_intelligence_settle(p_id uuid,p_client_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE r web_intelligence_runs; amount numeric;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_client_id::text,1497));
  SELECT * INTO r FROM web_intelligence_runs WHERE id=p_id AND client_id=p_client_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'run_not_found'; END IF;
  IF r.accounted_nzd IS NOT NULL THEN RETURN to_jsonb(r); END IF;
  IF r.capture_cost_usd IS NULL OR r.interpretation_cost_usd IS NULL THEN
    UPDATE web_intelligence_runs SET status='reconciliation',error_code='unknown_cost',updated_at=now() WHERE id=p_id RETURNING * INTO r;
    RETURN to_jsonb(r);
  END IF;
  amount := (r.capture_cost_usd+r.interpretation_cost_usd)*r.fx_rate+r.overhead_nzd;
  UPDATE web_intelligence_runs SET accounted_nzd=amount,
    status=CASE WHEN amount>reserved_nzd THEN 'reconciliation' WHEN status='failed' THEN 'failed' ELSE 'complete' END,
    error_code=CASE WHEN amount>reserved_nzd THEN 'cost_exceeded_reservation' ELSE error_code END,updated_at=now()
    WHERE id=p_id RETURNING * INTO r;
  RETURN to_jsonb(r);
END $$;
-- Explicit service-only access; no browser or signed-in role can bypass API isolation.
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['web_intelligence_settings','competitor_monitoring_metadata','web_intelligence_runs','market_snapshots','market_evidence','market_signals'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated',t);
    EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON public.%I TO service_role',t);
    EXECUTE format('CREATE POLICY service_role_all ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)',t);
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.web_intelligence_reserve(uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.web_intelligence_record_snapshot(uuid,uuid,text,text,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.web_intelligence_settle(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.web_intelligence_reserve(uuid,uuid,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.web_intelligence_record_snapshot(uuid,uuid,text,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.web_intelligence_settle(uuid,uuid) TO service_role;

CREATE FUNCTION public.web_intelligence_budget(p_client_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT jsonb_build_object('accounted_nzd',coalesce(sum(accounted_nzd),0),
    'reserved_nzd',coalesce(sum(CASE WHEN accounted_nzd IS NULL THEN reserved_nzd ELSE 0 END),0))
  FROM web_intelligence_runs WHERE client_id=p_client_id AND period_key=to_char(now() AT TIME ZONE 'Pacific/Auckland','YYYY-MM');
$$;
REVOKE ALL ON FUNCTION public.web_intelligence_budget(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.web_intelligence_budget(uuid) TO service_role;

-- Re-check current entitlement atomically at the first paid attempt, not just enqueue time.
CREATE FUNCTION public.web_intelligence_claim(p_id uuid,p_client_id uuid,p_stage text)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE s web_intelligence_settings; r web_intelligence_runs;
BEGIN
  IF p_stage NOT IN ('capture','interpretation') OR p_stage IS NULL THEN RAISE EXCEPTION 'invalid_stage'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_client_id::text,1497));
  SELECT * INTO r FROM web_intelligence_runs WHERE id=p_id AND client_id=p_client_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'run_not_found'; END IF;
  -- A previously claimed attempt may already have charged, even after disablement.
  IF (p_stage='capture' AND r.capture_claimed) OR (p_stage='interpretation' AND r.interpretation_claimed) THEN RETURN false; END IF;
  SELECT * INTO s FROM web_intelligence_settings WHERE client_id=p_client_id FOR UPDATE;
  IF NOT FOUND OR NOT s.enabled OR NOT s.entitled THEN RAISE EXCEPTION 'execution_disabled'; END IF;
  IF p_stage='capture' THEN
    IF r.capture_claimed THEN RETURN false; END IF;
    UPDATE web_intelligence_runs SET capture_claimed=true,status='capturing',updated_at=now() WHERE id=p_id;
  ELSE
    IF r.interpretation_claimed THEN RETURN false; END IF;
    UPDATE web_intelligence_runs SET interpretation_claimed=true,status='understanding',updated_at=now() WHERE id=p_id;
  END IF;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.web_intelligence_claim(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.web_intelligence_claim(uuid,uuid,text) TO service_role;
