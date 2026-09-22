-- ME-WI.0.2-A: one immutable, client-scoped observation shape for every
-- external intelligence channel. This migration is intentionally additive;
-- event synthesis and provider-specific ingestion remain separate phases.
CREATE TABLE public.web_intelligence_external_observations (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id          uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  source_type        text NOT NULL CHECK (source_type IN (
    'website','mainstream_news','industry_news','industry_media','jobs',
    'facebook_group','serp','public_ads','ai_visibility','reputation'
  )),
  source_tier        text NOT NULL CHECK (source_tier IN ('A','B','C')),
  source_name        text NOT NULL CHECK (length(btrim(source_name)) BETWEEN 1 AND 120),
  source_url         text NOT NULL CHECK (length(source_url) BETWEEN 1 AND 2048),
  canonical_url      text NOT NULL CHECK (length(canonical_url) BETWEEN 1 AND 2048),
  title              text NOT NULL DEFAULT '' CHECK (length(title) <= 500),
  excerpt            text NOT NULL CHECK (length(excerpt) <= 5000),
  competitor_domain  text CHECK (competitor_domain IS NULL OR length(competitor_domain) <= 253),
  published_at       timestamptz,
  observed_at        timestamptz NOT NULL,
  valid_until        timestamptz,
  content_hash       text NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  status             text NOT NULL DEFAULT 'observed' CHECK (status IN ('observed','stale','unavailable','rejected')),
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, canonical_url, content_hash)
);

CREATE INDEX web_intelligence_external_observations_client_time
  ON public.web_intelligence_external_observations(client_id, observed_at DESC);

CREATE INDEX web_intelligence_external_observations_client_source
  ON public.web_intelligence_external_observations(client_id, source_type, observed_at DESC);

ALTER TABLE public.web_intelligence_external_observations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.web_intelligence_external_observations FROM anon, authenticated;
GRANT ALL ON public.web_intelligence_external_observations TO service_role;

CREATE POLICY web_intelligence_external_observations_service_role
  ON public.web_intelligence_external_observations
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE public.web_intelligence_external_observations IS
  'Immutable client-scoped external intelligence observations. C-tier sources, including authorised Facebook Group signals, are corroborating evidence only.';
