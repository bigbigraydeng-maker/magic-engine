-- ============================================
-- Viral Reference Library — Phase 11.0-R
-- 2026-05-29
-- ============================================

-- 1. Add industry column to clients (nullable, e.g. 'travel' | 'flooring')
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS industry TEXT;

-- 2. viral_reference_library: stores externally-sourced viral video references
--    for cold-start style learning before ME has its own performance data.
CREATE TABLE IF NOT EXISTS public.viral_reference_library (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  industry          TEXT NOT NULL,
  client_id         UUID REFERENCES public.clients(id) ON DELETE SET NULL,
  source_url        TEXT NOT NULL,
  platform          TEXT NOT NULL,      -- 'youtube' | 'facebook' | 'tiktok' | 'instagram'
  title             TEXT,

  -- VLM analysis output (populated after Gemini processes the video)
  style_scores      JSONB,              -- {energy,luxury,authenticity,emotional,humor,urgency,offer_signal} 0-10
  style_tags        TEXT[],             -- e.g. ['fast-cut','outdoor','luxury-resort']
  style_description TEXT,              -- natural language summary
  persona_fit       TEXT[],             -- buyer persona labels
  key_techniques    TEXT[],             -- e.g. ['drone-aerial-opening','ugc-selfie-style']

  analysis_status   TEXT NOT NULL DEFAULT 'pending'
                    CHECK (analysis_status IN ('pending','analyzing','done','error')),
  analysis_error    TEXT,
  notes             TEXT,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  analyzed_at       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS viral_refs_industry_status_idx
  ON public.viral_reference_library(industry, analysis_status);

ALTER TABLE public.viral_reference_library ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_full"
  ON public.viral_reference_library FOR ALL TO service_role
  USING (true) WITH CHECK (true);
