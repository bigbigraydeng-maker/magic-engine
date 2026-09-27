-- Meta data deletion callback (Magic Bridge self-serve opening, PR-3).
-- Design: docs/specs/2026-09-27-magic-bridge-self-serve-open-design.md §8.5.
--
-- When a person removes the Magic Engine app in Facebook and asks for their data to be
-- deleted, Meta POSTs a signed request to /api/meta/data-deletion. The route verifies the
-- signature and calls public.meta_process_data_deletion(), which:
--   1. revokes every read-only ads connection of that Facebook user, in every client
--      (status -> revoked, owner -> NULL, token untouched: the only owner change the
--      connection guard allows; the AFTER UPDATE trigger revokes the grants),
--   2. then blanks the encrypted tokens (owner already NULL, so the guard does not fire),
--   3. clears report contents (evidence, report_markdown) of every analysis job created
--      through those connections' grants — jobs reference grants ON DELETE RESTRICT, so
--      rows are kept and emptied instead of hard-deleted,
--   4. revokes API keys minted on those grants,
--   5. records the request (hashed user id only) for status lookup and replay protection.
-- A connection the person re-authorised after the request was issued (still active, and
-- last_synced_at — written only on a fresh Facebook authorisation — is later than issued_at)
-- is skipped, so replaying an old request cannot wipe a connection they re-created. Any other
-- write to the row (a disconnect, a trigger) does not shield it from deletion.
-- The plain Facebook user id is not kept anywhere afterwards: revoked rows get a stand-in
-- account id ('ads_user:0…' — real Meta ids never start with 0, so it can never match anyone).

CREATE TABLE IF NOT EXISTS public.meta_data_deletion_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  confirmation_code text NOT NULL UNIQUE CHECK (confirmation_code ~ '^[A-Za-z0-9_-]{24,64}$'),
  app_user_hash text NOT NULL CHECK (app_user_hash ~ '^[0-9a-f]{64}$'),
  issued_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL CHECK (status IN ('completed', 'no_data', 'failed')),
  connections_revoked integer NOT NULL DEFAULT 0 CHECK (connections_revoked >= 0),
  reports_cleared integer NOT NULL DEFAULT 0 CHECK (reports_cleared >= 0),
  keys_revoked integer NOT NULL DEFAULT 0 CHECK (keys_revoked >= 0)
);
-- One processed answer per request; failed attempts (recorded by the route for the PM daily
-- to-do list) may repeat.
CREATE UNIQUE INDEX IF NOT EXISTS meta_data_deletion_requests_processed_uniq
  ON public.meta_data_deletion_requests (app_user_hash, issued_at) WHERE status <> 'failed';
CREATE INDEX IF NOT EXISTS meta_data_deletion_requests_received_idx
  ON public.meta_data_deletion_requests (received_at DESC);

ALTER TABLE public.meta_data_deletion_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS service_role_full ON public.meta_data_deletion_requests;
CREATE POLICY service_role_full ON public.meta_data_deletion_requests
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.meta_data_deletion_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.meta_data_deletion_requests TO service_role;

CREATE OR REPLACE FUNCTION public.meta_process_data_deletion(
  p_app_user_id text,
  p_app_user_hash text,
  p_issued_at timestamptz,
  p_confirmation text
) RETURNS TABLE (
  confirmation_code text,
  status text,
  connections_revoked integer,
  reports_cleared integer,
  keys_revoked integer
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
#variable_conflict use_column
DECLARE
  conn_ids uuid[];
  grant_ids uuid[];
  n_conn integer := 0;
  n_reports integer := 0;
  n_keys integer := 0;
  final_status text;
BEGIN
  IF p_app_user_id IS NULL OR p_app_user_id !~ '^[0-9]{1,32}$' THEN
    RAISE EXCEPTION 'invalid app user id' USING ERRCODE = '22023';
  END IF;
  IF p_app_user_hash IS NULL OR p_app_user_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid app user hash' USING ERRCODE = '22023';
  END IF;
  IF p_issued_at IS NULL OR p_issued_at > now() + interval '5 minutes' THEN
    RAISE EXCEPTION 'invalid issued_at' USING ERRCODE = '22023';
  END IF;

  -- Serialise requests for the same person, then answer a replay with the stored result.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_app_user_hash, 0));
  RETURN QUERY
    SELECT r.confirmation_code, r.status, r.connections_revoked, r.reports_cleared, r.keys_revoked
      FROM public.meta_data_deletion_requests r
     WHERE r.app_user_hash = p_app_user_hash AND r.issued_at = p_issued_at AND r.status <> 'failed';
  IF FOUND THEN
    RETURN;
  END IF;

  SELECT coalesce(array_agg(c.id), '{}') INTO conn_ids
    FROM (
      SELECT pc.id FROM public.platform_oauth_connections pc
       WHERE pc.purpose = 'meta_ads_read'
         AND pc.account_id = 'ads_user:' || p_app_user_id
         AND NOT (pc.status = 'active' AND pc.last_synced_at IS NOT NULL AND pc.last_synced_at > p_issued_at)
       FOR UPDATE
    ) c;

  SELECT coalesce(array_agg(g.id), '{}') INTO grant_ids
    FROM public.meta_ads_read_grants g
   WHERE g.connection_id = ANY (conn_ids);

  -- 1. Revoke with the token untouched (owner -> NULL is only allowed together with revoke).
  UPDATE public.platform_oauth_connections
     SET status = 'revoked', authorizing_principal_id = NULL, updated_at = now()
   WHERE id = ANY (conn_ids)
     AND (status <> 'revoked' OR authorizing_principal_id IS NOT NULL);

  -- 2. Blank the encrypted tokens and replace the Facebook user id with a stand-in
  --    (owner is already NULL, status revoked, so the connection guard does not fire).
  UPDATE public.platform_oauth_connections
     SET access_token_enc = '', refresh_token_enc = '',
         account_id = 'ads_user:0' || abs(hashtextextended(id::text, 0))::text,
         updated_at = now()
   WHERE id = ANY (conn_ids);
  GET DIAGNOSTICS n_conn = ROW_COUNT;

  -- 3. Empty report contents made through those grants.
  --    A job still running is closed as failed so its later finish cannot write a report back.
  UPDATE public.meta_ads_ai_analysis_jobs
     SET evidence = NULL, report_markdown = NULL, error_code = 'deleted_by_user_request',
         status = CASE WHEN status = 'running' THEN 'failed' ELSE status END,
         completed_at = coalesce(completed_at, now())
   WHERE grant_id = ANY (grant_ids)
     AND (evidence IS NOT NULL OR report_markdown IS NOT NULL OR error_code IS DISTINCT FROM 'deleted_by_user_request');
  GET DIAGNOSTICS n_reports = ROW_COUNT;

  -- 4. Revoke API keys minted on those grants.
  UPDATE public.client_api_keys
     SET revoked_at = now()
   WHERE revoked_at IS NULL
     AND metadata ->> 'meta_ads_grant_id' = ANY (SELECT unnest(grant_ids)::text);
  GET DIAGNOSTICS n_keys = ROW_COUNT;

  final_status := CASE WHEN cardinality(conn_ids) = 0 THEN 'no_data' ELSE 'completed' END;

  INSERT INTO public.meta_data_deletion_requests
    (confirmation_code, app_user_hash, issued_at, status, connections_revoked, reports_cleared, keys_revoked)
  VALUES
    (p_confirmation, p_app_user_hash, p_issued_at, final_status, n_conn, n_reports, n_keys);

  RETURN QUERY SELECT p_confirmation, final_status, n_conn, n_reports, n_keys;
END;
$$;

REVOKE ALL ON FUNCTION public.meta_process_data_deletion(text, text, timestamptz, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.meta_process_data_deletion(text, text, timestamptz, text)
  TO service_role;
