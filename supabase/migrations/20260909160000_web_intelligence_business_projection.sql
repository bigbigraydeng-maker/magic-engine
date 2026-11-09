-- Compare versioned business content while retaining the complete provider evidence.
-- Existing snapshots remain legacy baselines and cannot produce upgrade noise.
ALTER TABLE public.market_snapshots
  ADD COLUMN final_url text,
  ADD COLUMN raw_content_hash text,
  ADD COLUMN projection_content text,
  ADD COLUMN projection_hash text,
  ADD COLUMN projection_version text,
  ADD COLUMN page_role text;

ALTER TABLE public.market_snapshots
  ADD CONSTRAINT market_snapshots_projection_length CHECK (projection_content IS NULL OR length(projection_content) BETWEEN 80 AND 200000),
  ADD CONSTRAINT market_snapshots_page_role CHECK (page_role IS NULL OR page_role IN ('homepage','product_listing','product_detail','offers','news','other'));

CREATE INDEX market_snapshots_projection_target
  ON public.market_snapshots(client_id,domain,url,projection_version,page_role,captured_at DESC);

CREATE FUNCTION public.web_intelligence_record_business_snapshot(
  p_id uuid,
  p_client_id uuid,
  p_final_url text,
  p_title text,
  p_raw_content text,
  p_raw_hash text,
  p_projection text,
  p_projection_hash text,
  p_projection_version text,
  p_page_role text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  r web_intelligence_runs;
  previous market_snapshots;
  sn market_snapshots;
  ev uuid;
  before_ev uuid;
  signal_id uuid;
  result_state text;
BEGIN
  IF p_final_url IS NULL OR p_final_url='' OR p_raw_content IS NULL OR p_projection IS NULL OR
     p_raw_hash IS NULL OR p_raw_hash='' OR p_projection_hash IS NULL OR p_projection_hash='' OR
     p_projection_version IS NULL OR p_projection_version='' OR
     p_page_role IS NULL OR p_page_role NOT IN ('homepage','product_listing','product_detail','offers','news','other') OR
     length(p_raw_content) NOT BETWEEN 80 AND 200000 OR length(p_projection) NOT BETWEEN 80 AND 200000
  THEN RAISE EXCEPTION 'invalid_business_snapshot'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_client_id::text,1497));
  SELECT * INTO r FROM web_intelligence_runs WHERE id=p_id AND client_id=p_client_id FOR UPDATE;
  IF NOT FOUND OR r.provider_run_id IS NULL OR r.provider_status IS DISTINCT FROM 'SUCCEEDED' THEN RAISE EXCEPTION 'capture_not_verified'; END IF;

  SELECT * INTO sn FROM market_snapshots WHERE run_id=p_id AND client_id=p_client_id;
  IF FOUND THEN
    SELECT id INTO signal_id FROM market_signals WHERE run_id=p_id AND client_id=p_client_id;
    RETURN jsonb_build_object('snapshot_id',sn.id,'signal_id',signal_id,'state','replayed');
  END IF;

  SELECT * INTO previous FROM market_snapshots
    WHERE client_id=p_client_id AND domain=r.domain AND url=r.url
      AND projection_version=p_projection_version AND page_role=p_page_role
    ORDER BY captured_at DESC,id DESC LIMIT 1;

  INSERT INTO market_snapshots(
    client_id,run_id,domain,url,final_url,title,content,content_hash,raw_content_hash,
    projection_content,projection_hash,projection_version,page_role,collector_version
  ) VALUES (
    p_client_id,p_id,r.domain,r.url,p_final_url,p_title,p_raw_content,p_raw_hash,p_raw_hash,
    p_projection,p_projection_hash,p_projection_version,p_page_role,'website-business-v1'
  ) RETURNING * INTO sn;

  INSERT INTO market_evidence(client_id,snapshot_id,source_url,excerpt,content_hash)
    VALUES(p_client_id,sn.id,p_final_url,p_projection,p_projection_hash) RETURNING id INTO ev;

  IF previous.id IS NOT NULL AND previous.projection_hash<>p_projection_hash THEN
    SELECT id INTO before_ev FROM market_evidence WHERE snapshot_id=previous.id AND client_id=p_client_id;
    IF before_ev IS NULL THEN RAISE EXCEPTION 'previous_evidence_missing'; END IF;
    INSERT INTO market_signals(client_id,run_id,domain,kind,before_evidence_id,after_evidence_id)
      VALUES(p_client_id,p_id,r.domain,'business_page_changed',before_ev,ev) RETURNING id INTO signal_id;
  END IF;

  result_state := CASE
    WHEN previous.id IS NULL THEN 'baseline'
    WHEN signal_id IS NOT NULL THEN 'changed'
    WHEN previous.raw_content_hash IS DISTINCT FROM p_raw_hash THEN 'technical_noise'
    ELSE 'unchanged'
  END;
  UPDATE web_intelligence_runs SET status='captured',updated_at=now() WHERE id=p_id;
  RETURN jsonb_build_object('snapshot_id',sn.id,'signal_id',signal_id,'state',result_state);
END $$;

REVOKE ALL ON FUNCTION public.web_intelligence_record_business_snapshot(uuid,uuid,text,text,text,text,text,text,text,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.web_intelligence_record_business_snapshot(uuid,uuid,text,text,text,text,text,text,text,text)
  TO service_role;
