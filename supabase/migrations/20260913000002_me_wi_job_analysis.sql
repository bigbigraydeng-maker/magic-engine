ALTER TABLE public.web_intelligence_external_observations
  ADD COLUMN IF NOT EXISTS analysis JSONB;

COMMENT ON COLUMN public.web_intelligence_external_observations.analysis IS
  'Optional structured Haiku analysis for a job signal; raw observation remains the source of truth.';
