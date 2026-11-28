CREATE TABLE IF NOT EXISTS public.social_growth_onboarding_plans (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id          UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  industry_profile   TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'reviewed')),
  inputs             JSONB NOT NULL,
  recommendation     JSONB NOT NULL,
  evidence_snapshot  JSONB NOT NULL,
  generation_meta    JSONB NOT NULL,
  generated_by       TEXT,
  reviewed_by        TEXT,
  reviewed_at        TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT social_growth_onboarding_industry_profile CHECK (
    industry_profile IN ('general', 'travel', 'real_estate', 'ecommerce', 'local_service', 'b2b', 'regulated')
  ),
  CONSTRAINT social_growth_onboarding_review_state CHECK (
    (status = 'draft' AND reviewed_at IS NULL AND reviewed_by IS NULL)
    OR (status = 'reviewed' AND reviewed_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_social_growth_onboarding_client_created
  ON public.social_growth_onboarding_plans(client_id, created_at DESC);

ALTER TABLE public.social_growth_onboarding_plans ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.social_growth_onboarding_plans FROM anon, authenticated;
GRANT ALL ON TABLE public.social_growth_onboarding_plans TO service_role;

CREATE POLICY social_growth_onboarding_service_role_full
  ON public.social_growth_onboarding_plans
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.update_social_growth_onboarding_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER social_growth_onboarding_updated_at
  BEFORE UPDATE ON public.social_growth_onboarding_plans
  FOR EACH ROW EXECUTE FUNCTION public.update_social_growth_onboarding_updated_at();

COMMENT ON TABLE public.social_growth_onboarding_plans IS
  'Client-scoped draft and review history for Facebook social growth onboarding recommendations. Does not authorize publishing or ad execution.';
