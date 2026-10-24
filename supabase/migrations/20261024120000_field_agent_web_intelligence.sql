-- Field-agent pilot: ME owns the task row and human review; an external
-- assistant writes Web Intelligence observations. Additive only.
-- Screenshot bucket is private. service_role is the only granted role.

CREATE TABLE public.field_agent_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  task_type text NOT NULL CHECK (task_type IN (
    'competitor_ads_scan', 'google_maps_rating', 'tripadvisor_scan', 'ai_answer_scan'
  )),
  params jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (
    jsonb_typeof(params) = 'object' AND octet_length(params::text) <= 20000
  ),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed')),
  requested_by text NOT NULL CHECK (length(btrim(requested_by)) BETWEEN 1 AND 200),
  result_summary jsonb CHECK (
    result_summary IS NULL OR (jsonb_typeof(result_summary) = 'object' AND octet_length(result_summary::text) <= 8000)
  ),
  error text CHECK (error IS NULL OR length(error) <= 2000),
  dispatched_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX field_agent_tasks_client_status
  ON public.field_agent_tasks (client_id, status, created_at DESC);

COMMENT ON TABLE public.field_agent_tasks IS
  'One dispatched field-agent job. ME inserts queued; the agent moves running then done or failed.';

ALTER TABLE public.field_agent_tasks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.field_agent_tasks FROM anon, authenticated;
GRANT ALL ON public.field_agent_tasks TO service_role;

CREATE POLICY field_agent_tasks_service_role
  ON public.field_agent_tasks
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

CREATE FUNCTION public.field_agent_tasks_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.client_id IS DISTINCT FROM OLD.client_id
       OR NEW.task_type IS DISTINCT FROM OLD.task_type
       OR NEW.params IS DISTINCT FROM OLD.params
       OR NEW.requested_by IS DISTINCT FROM OLD.requested_by
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'field_agent_task_identity_immutable';
    END IF;
    IF OLD.status IN ('done', 'failed') AND NEW.status IS DISTINCT FROM OLD.status THEN
      RAISE EXCEPTION 'field_agent_task_terminal';
    ELSIF OLD.status = 'queued' AND NEW.status NOT IN ('queued', 'running', 'done', 'failed') THEN
      RAISE EXCEPTION 'field_agent_task_bad_transition';
    ELSIF OLD.status = 'running' AND NEW.status NOT IN ('running', 'done', 'failed') THEN
      RAISE EXCEPTION 'field_agent_task_bad_transition';
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

CREATE TRIGGER field_agent_tasks_guard
  BEFORE INSERT OR UPDATE ON public.field_agent_tasks
  FOR EACH ROW EXECUTE FUNCTION public.field_agent_tasks_guard();

-- Authoritative payload gate for the four field-agent source types.
-- Other source types stay unrestricted here so existing writers keep working.
CREATE FUNCTION public.field_agent_payload_allowed(p_source text, p_payload jsonb)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  rating numeric;
  review_count numeric;
BEGIN
  IF p_source NOT IN ('meta_ad_library', 'google_maps_rating', 'tripadvisor', 'ai_answer') THEN
    RETURN true;
  END IF;
  IF jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR octet_length(p_payload::text) > 20000 THEN
    RETURN false;
  END IF;

  IF p_source = 'meta_ad_library' THEN
    IF length(btrim(coalesce(p_payload->>'competitor_name', ''))) NOT BETWEEN 1 AND 200 THEN RETURN false; END IF;
    IF length(btrim(coalesce(p_payload->>'ad_library_id', ''))) NOT BETWEEN 1 AND 80 THEN RETURN false; END IF;
    IF p_payload->>'ad_library_id' !~ '^[A-Za-z0-9_-]+$' THEN RETURN false; END IF;
    IF coalesce(length(p_payload->>'primary_text'), 0) > 5000 THEN RETURN false; END IF;
    IF coalesce(length(p_payload->>'headline'), 0) > 500 THEN RETURN false; END IF;
    IF coalesce(length(p_payload->>'cta'), 0) > 80 THEN RETURN false; END IF;
    IF coalesce(length(p_payload->>'offer_text'), 0) > 500 THEN RETURN false; END IF;
    IF coalesce(length(p_payload->>'facebook_page_id'), 0) > 64 THEN RETURN false; END IF;
    IF length(btrim(coalesce(p_payload->>'primary_text', ''))) = 0
       AND length(btrim(coalesce(p_payload->>'headline', ''))) = 0
       AND length(btrim(coalesce(p_payload->>'offer_text', ''))) = 0 THEN
      RETURN false;
    END IF;
    IF coalesce(p_payload->>'landing_url', '') <> '' AND p_payload->>'landing_url' !~ '^https://' THEN RETURN false; END IF;
    IF coalesce(length(p_payload->>'landing_url'), 0) > 2048 THEN RETURN false; END IF;
    IF coalesce(p_payload->>'facebook_page_url', '') <> '' AND p_payload->>'facebook_page_url' !~ '^https://' THEN RETURN false; END IF;
    IF coalesce(length(p_payload->>'facebook_page_url'), 0) > 2048 THEN RETURN false; END IF;
    IF p_payload ? 'started_running_on'
       AND nullif(p_payload->>'started_running_on', '') IS NOT NULL
       AND p_payload->>'started_running_on' !~ '^\d{4}-\d{2}-\d{2}$' THEN
      RETURN false;
    END IF;
    IF jsonb_typeof(p_payload->'platforms') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
    IF jsonb_array_length(p_payload->'platforms') NOT BETWEEN 1 AND 8 THEN RETURN false; END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_payload->'platforms') AS t(value)
      WHERE jsonb_typeof(t.value) IS DISTINCT FROM 'string'
         OR (t.value #>> '{}') NOT IN ('facebook', 'instagram', 'messenger', 'audience_network', 'threads')
    ) THEN
      RETURN false;
    END IF;
    RETURN true;
  END IF;

  IF p_source = 'google_maps_rating' OR p_source = 'tripadvisor' THEN
    IF length(btrim(coalesce(p_payload->>'competitor_name', ''))) NOT BETWEEN 1 AND 200 THEN RETURN false; END IF;
    IF jsonb_typeof(p_payload->'rating') IS DISTINCT FROM 'number' THEN RETURN false; END IF;
    IF jsonb_typeof(p_payload->'review_count') IS DISTINCT FROM 'number' THEN RETURN false; END IF;
    rating := (p_payload->>'rating')::numeric;
    review_count := (p_payload->>'review_count')::numeric;
    IF rating < 0 OR rating > 5 OR review_count < 0 OR review_count <> trunc(review_count) OR review_count > 100000000 THEN
      RETURN false;
    END IF;
    IF p_source = 'google_maps_rating' THEN
      IF length(btrim(coalesce(p_payload->>'maps_url', ''))) NOT BETWEEN 8 AND 2048 THEN RETURN false; END IF;
      IF p_payload->>'maps_url' !~ '^https://' THEN RETURN false; END IF;
    ELSE
      IF length(btrim(coalesce(p_payload->>'location_url', ''))) NOT BETWEEN 8 AND 2048 THEN RETURN false; END IF;
      IF p_payload->>'location_url' !~ '^https://' THEN RETURN false; END IF;
    END IF;
    RETURN true;
  END IF;

  IF length(btrim(coalesce(p_payload->>'query', ''))) NOT BETWEEN 1 AND 500 THEN RETURN false; END IF;
  IF coalesce(p_payload->>'engine', '') NOT IN (
    'google_ai_overview', 'chatgpt', 'perplexity', 'gemini', 'copilot', 'other'
  ) THEN
    RETURN false;
  END IF;
  IF jsonb_typeof(p_payload->'mentioned') IS DISTINCT FROM 'boolean' THEN RETURN false; END IF;
  IF p_payload ? 'citation_urls' AND p_payload->'citation_urls' IS NOT NULL THEN
    IF jsonb_typeof(p_payload->'citation_urls') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
    IF jsonb_array_length(p_payload->'citation_urls') > 8 THEN RETURN false; END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_payload->'citation_urls') AS t(value)
      WHERE jsonb_typeof(t.value) IS DISTINCT FROM 'string'
         OR (t.value #>> '{}') !~ '^https://'
         OR length(t.value #>> '{}') > 2048
    ) THEN
      RETURN false;
    END IF;
  END IF;
  RETURN true;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
  RETURN false;
END $$;

DO $$
DECLARE cname text;
BEGIN
  SELECT con.conname INTO cname
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
  WHERE nsp.nspname = 'public'
    AND rel.relname = 'web_intelligence_external_observations'
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) ILIKE '%source_type IN%';
  IF cname IS NULL THEN
    RAISE EXCEPTION 'source_type_check_missing';
  END IF;
  EXECUTE format('ALTER TABLE public.web_intelligence_external_observations DROP CONSTRAINT %I', cname);
END $$;

ALTER TABLE public.web_intelligence_external_observations
  ADD CONSTRAINT web_intelligence_external_observations_source_type_check
  CHECK (source_type IN (
    'website', 'mainstream_news', 'industry_news', 'industry_media', 'jobs',
    'facebook_group', 'serp', 'public_ads', 'ai_visibility', 'reputation',
    'meta_ad_library', 'google_maps_rating', 'tripadvisor', 'ai_answer'
  ));

ALTER TABLE public.web_intelligence_external_observations
  ADD COLUMN payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN review_status text NOT NULL DEFAULT 'not_required',
  ADD COLUMN reviewed_by text,
  ADD COLUMN reviewed_at timestamptz,
  ADD COLUMN review_notes text,
  ADD COLUMN task_id uuid REFERENCES public.field_agent_tasks(id) ON DELETE SET NULL,
  ADD COLUMN screenshot_path text;

ALTER TABLE public.web_intelligence_external_observations
  ADD CONSTRAINT web_intelligence_external_observations_payload_check
  CHECK (
    jsonb_typeof(payload) = 'object'
    AND octet_length(payload::text) <= 20000
    AND public.field_agent_payload_allowed(source_type, payload)
  ),
  ADD CONSTRAINT web_intelligence_external_observations_review_status_check
  CHECK (review_status IN ('not_required', 'pending', 'approved', 'rejected')),
  ADD CONSTRAINT web_intelligence_external_observations_reviewer_check
  CHECK (
    (review_status IN ('not_required', 'pending') AND reviewed_by IS NULL AND reviewed_at IS NULL)
    OR (review_status IN ('approved', 'rejected') AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL
        AND length(btrim(reviewed_by)) BETWEEN 1 AND 200)
  ),
  ADD CONSTRAINT web_intelligence_external_observations_review_notes_check
  CHECK (review_notes IS NULL OR length(review_notes) <= 2000),
  ADD CONSTRAINT web_intelligence_external_observations_screenshot_path_check
  CHECK (
    screenshot_path IS NULL
    OR (
      screenshot_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[A-Za-z0-9._-]{1,120}$'
      AND split_part(screenshot_path, '/', 1) = client_id::text
      AND (task_id IS NULL OR split_part(screenshot_path, '/', 2) = task_id::text)
    )
  );

CREATE INDEX web_intelligence_external_observations_review
  ON public.web_intelligence_external_observations (client_id, review_status, observed_at DESC);

CREATE INDEX web_intelligence_external_observations_task
  ON public.web_intelligence_external_observations (task_id)
  WHERE task_id IS NOT NULL;

COMMENT ON COLUMN public.web_intelligence_external_observations.payload IS
  'Structured field-agent facts. meta_ad_library requires competitor_name, ad_library_id, platforms, and one of primary_text, headline, offer_text.';
COMMENT ON COLUMN public.web_intelligence_external_observations.review_status IS
  'not_required for existing automated rows. Field-agent inserts with a task_id must be pending until a person approves or rejects.';
COMMENT ON COLUMN public.web_intelligence_external_observations.screenshot_path IS
  'Object path inside the private field-agent-screenshots bucket: <client_id>/<task_id>/<file>.';

CREATE FUNCTION public.web_intelligence_external_observations_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.task_id IS NOT NULL AND NEW.review_status IS DISTINCT FROM 'pending' THEN
      RAISE EXCEPTION 'field_agent_observation_must_be_pending';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.review_status IS DISTINCT FROM OLD.review_status
     OR NEW.reviewed_by IS DISTINCT FROM OLD.reviewed_by
     OR NEW.reviewed_at IS DISTINCT FROM OLD.reviewed_at
     OR NEW.review_notes IS DISTINCT FROM OLD.review_notes THEN
    IF current_setting('me.field_review', true) IS DISTINCT FROM 'on' THEN
      RAISE EXCEPTION 'review_requires_dashboard';
    END IF;
  END IF;
  IF NEW.client_id IS DISTINCT FROM OLD.client_id
     OR NEW.source_type IS DISTINCT FROM OLD.source_type
     OR NEW.source_tier IS DISTINCT FROM OLD.source_tier
     OR NEW.source_name IS DISTINCT FROM OLD.source_name
     OR NEW.source_url IS DISTINCT FROM OLD.source_url
     OR NEW.canonical_url IS DISTINCT FROM OLD.canonical_url
     OR NEW.title IS DISTINCT FROM OLD.title
     OR NEW.excerpt IS DISTINCT FROM OLD.excerpt
     OR NEW.competitor_domain IS DISTINCT FROM OLD.competitor_domain
     OR NEW.published_at IS DISTINCT FROM OLD.published_at
     OR NEW.observed_at IS DISTINCT FROM OLD.observed_at
     OR NEW.valid_until IS DISTINCT FROM OLD.valid_until
     OR NEW.content_hash IS DISTINCT FROM OLD.content_hash
     OR NEW.status IS DISTINCT FROM OLD.status
     OR NEW.payload IS DISTINCT FROM OLD.payload
     OR NEW.task_id IS DISTINCT FROM OLD.task_id
     OR NEW.screenshot_path IS DISTINCT FROM OLD.screenshot_path
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'external_observation_immutable';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER web_intelligence_external_observations_guard
  BEFORE INSERT OR UPDATE ON public.web_intelligence_external_observations
  FOR EACH ROW EXECUTE FUNCTION public.web_intelligence_external_observations_guard();

-- Close runs that never reached complete/failed. Unknown provider spend is
-- charged at the existing reservation ceiling so the next month is not locked
-- by an unsettled row. Matches src/lib/web-intelligence/stale-runs.ts.
CREATE FUNCTION public.web_intelligence_close_stale_runs(
  p_client_id uuid,
  p_timeout interval DEFAULT interval '6 hours'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  rec web_intelligence_runs;
  capture numeric;
  interpretation numeric;
  closed uuid[] := ARRAY[]::uuid[];
  skipped integer := 0;
  settled jsonb;
BEGIN
  IF p_client_id IS NULL OR p_timeout IS NULL OR p_timeout < interval '1 hour' THEN
    RAISE EXCEPTION 'invalid_closeout';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_client_id::text, 1497));
  FOR rec IN
    SELECT * FROM public.web_intelligence_runs
    WHERE client_id = p_client_id
      AND status NOT IN ('complete', 'failed')
      AND accounted_nzd IS NULL
      AND updated_at < now() - p_timeout
    ORDER BY created_at
    FOR UPDATE
  LOOP
    capture := COALESCE(
      rec.capture_cost_usd,
      CASE WHEN rec.capture_claimed OR rec.provider_run_id IS NOT NULL THEN rec.capture_limit_usd ELSE 0 END
    );
    interpretation := COALESCE(
      rec.interpretation_cost_usd,
      CASE
        WHEN rec.interpretation_claimed THEN LEAST(0.25, rec.capture_limit_usd + 0.25 - capture)
        ELSE 0
      END
    );
    IF capture < 0 OR interpretation < 0 OR capture + interpretation > rec.capture_limit_usd + 0.25 THEN
      skipped := skipped + 1;
      CONTINUE;
    END IF;
    UPDATE public.web_intelligence_runs
      SET capture_cost_usd = capture,
          interpretation_cost_usd = interpretation,
          status = 'failed',
          error_code = CASE
            WHEN rec.error_code IS NULL OR btrim(rec.error_code) = '' THEN 'stale_run_timeout'
            ELSE left('stale_run_timeout:' || rec.error_code, 200)
          END,
          updated_at = now()
      WHERE id = rec.id AND client_id = p_client_id;
    settled := public.web_intelligence_settle(rec.id, p_client_id);
    IF coalesce(settled->>'status', '') IS DISTINCT FROM 'failed'
       OR settled->>'accounted_nzd' IS NULL THEN
      RAISE EXCEPTION 'stale_closeout_not_settled';
    END IF;
    closed := closed || rec.id;
  END LOOP;
  RETURN jsonb_build_object('closed', to_jsonb(closed), 'skipped', skipped);
END $$;

CREATE FUNCTION public.web_intelligence_review_observation(
  p_id uuid,
  p_client_id uuid,
  p_status text,
  p_reviewer text,
  p_notes text
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF p_status NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'invalid_review_status';
  END IF;
  IF p_reviewer IS NULL OR length(btrim(p_reviewer)) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'reviewer_required';
  END IF;
  IF p_notes IS NOT NULL AND length(p_notes) > 2000 THEN
    RAISE EXCEPTION 'review_notes_too_long';
  END IF;
  PERFORM set_config('me.field_review', 'on', true);
  UPDATE public.web_intelligence_external_observations
    SET review_status = p_status,
        reviewed_by = btrim(p_reviewer),
        reviewed_at = now(),
        review_notes = nullif(btrim(coalesce(p_notes, '')), '')
    WHERE id = p_id AND client_id = p_client_id AND review_status = 'pending';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'observation_not_pending';
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.field_agent_tasks_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.field_agent_payload_allowed(text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.web_intelligence_external_observations_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.web_intelligence_close_stale_runs(uuid, interval) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.web_intelligence_review_observation(uuid, uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.field_agent_tasks_guard() TO service_role;
GRANT EXECUTE ON FUNCTION public.field_agent_payload_allowed(text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.web_intelligence_external_observations_guard() TO service_role;
GRANT EXECUTE ON FUNCTION public.web_intelligence_close_stale_runs(uuid, interval) TO service_role;
GRANT EXECUTE ON FUNCTION public.web_intelligence_review_observation(uuid, uuid, text, text, text) TO service_role;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'field-agent-screenshots',
  'field-agent-screenshots',
  false,
  5242880,
  ARRAY['image/png', 'image/jpeg', 'image/webp']::text[]
)
ON CONFLICT (id) DO UPDATE
  SET public = false,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

COMMENT ON TABLE public.field_agent_tasks IS
  'Field-agent jobs. Observations land in web_intelligence_external_observations. Screenshots go to private bucket field-agent-screenshots.';
