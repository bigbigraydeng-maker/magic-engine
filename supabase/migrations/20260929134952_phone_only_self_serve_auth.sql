-- Allow phone-only self-serve identities while preserving legacy email members.
ALTER TABLE public.client_portal_users
  ALTER COLUMN email DROP NOT NULL;

ALTER TABLE public.client_portal_users
  ADD COLUMN IF NOT EXISTS auth_user_id uuid
    REFERENCES auth.users(id) ON DELETE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS client_portal_users_auth_user_client_key
  ON public.client_portal_users (auth_user_id, client_id)
  WHERE auth_user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS client_portal_users_one_self_serve_per_auth_user_key
  ON public.client_portal_users (auth_user_id)
  WHERE auth_user_id IS NOT NULL AND access_type = 'self_serve';

COMMENT ON COLUMN public.client_portal_users.auth_user_id IS
  'Stable Supabase Auth identity for phone-only users and gradually linked legacy accounts.';

-- Workspace creation is idempotent by Auth user and serializes same-name
-- phone registrations. It runs only through the server-side service-role
-- client; no browser Auth role can execute it.
CREATE OR REPLACE FUNCTION public.create_phone_self_serve_workspace(
  p_auth_user_id uuid,
  p_business_name text,
  p_domain text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_client_id uuid;
  v_business_name text := btrim(p_business_name);
BEGIN
  IF p_auth_user_id IS NULL OR v_business_name IS NULL OR length(v_business_name) < 2 OR length(v_business_name) > 120 THEN
    RAISE EXCEPTION 'invalid_registration' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('me-phone-workspace:' || lower(v_business_name), 0));

  SELECT client_id INTO v_client_id
  FROM public.client_portal_users
  WHERE auth_user_id = p_auth_user_id AND access_type = 'self_serve'
  LIMIT 1;

  IF v_client_id IS NOT NULL THEN
    RETURN v_client_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.clients
    WHERE source = 'self_serve' AND lower(btrim(name)) = lower(v_business_name)
  ) THEN
    RAISE EXCEPTION 'business_exists' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.clients (name, contact_email, domain, source)
  VALUES (v_business_name, NULL, NULLIF(btrim(p_domain), ''), 'self_serve')
  RETURNING id INTO v_client_id;

  INSERT INTO public.client_portal_users (auth_user_id, email, client_id, display_name, access_type)
  VALUES (p_auth_user_id, NULL, v_client_id, v_business_name, 'self_serve');

  RETURN v_client_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_phone_self_serve_workspace(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_phone_self_serve_workspace(uuid, text, text) TO service_role;
