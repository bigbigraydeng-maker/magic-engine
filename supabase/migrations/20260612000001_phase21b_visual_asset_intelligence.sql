-- ============================================
-- Phase 21.B — Visual Asset Intelligence
-- client_assets + asset_storyboards tables
-- 2026-06-12
-- ============================================

-- 1. client_assets: uploaded images with vision analysis metadata
CREATE TABLE IF NOT EXISTS public.client_assets (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id           UUID        NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,

  -- Storage
  storage_url         TEXT        NOT NULL,
  original_filename   TEXT,
  file_size_bytes     BIGINT,
  mime_type           TEXT,

  -- Vision analysis pipeline status
  status              TEXT        NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'analyzing', 'analyzed', 'error')),
  error_message       TEXT,

  -- GPT-4o Vision output (freeform, no hardcoded industry schema)
  vision_metadata     JSONB       NOT NULL DEFAULT '{}'::JSONB,
  -- Shape: {
  --   objects: string[],      e.g. ["timber flooring", "modern living room"]
  --   scene: string,          e.g. "interior / exterior / product / warehouse"
  --   emotion: string,        e.g. "warm", "premium", "energetic"
  --   has_people: boolean,
  --   is_indoor: boolean,
  --   brand_elements: string[], e.g. ["logo visible", "brand colour"]
  --   quality_score: number,  0–10, visual quality
  --   ai_notes: string        free-text summary from Vision
  -- }

  -- Suitability scores (0.0–10.0), computed from vision_metadata
  hook_score          NUMERIC(4,2) NOT NULL DEFAULT 0,
  middle_score        NUMERIC(4,2) NOT NULL DEFAULT 0,
  cta_score           NUMERIC(4,2) NOT NULL DEFAULT 0,
  recommended_use     TEXT        CHECK (recommended_use IN ('hook', 'middle', 'cta', 'skip')),

  -- Soft-delete
  archived_at         TIMESTAMPTZ,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_client_assets_client
  ON public.client_assets(client_id);

CREATE INDEX IF NOT EXISTS idx_client_assets_status
  ON public.client_assets(client_id, status);

CREATE INDEX IF NOT EXISTS idx_client_assets_recommended_use
  ON public.client_assets(client_id, recommended_use);

-- GIN index for JSONB metadata queries (e.g. filter by scene or emotion)
CREATE INDEX IF NOT EXISTS idx_client_assets_vision_metadata
  ON public.client_assets USING GIN (vision_metadata);

ALTER TABLE public.client_assets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_full" ON public.client_assets
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TRIGGER client_assets_updated_at
  BEFORE UPDATE ON public.client_assets
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- 2. asset_storyboards: theme-driven storyboard plans with video prompts
CREATE TABLE IF NOT EXISTS public.asset_storyboards (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id           UUID        NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,

  -- User-provided theme / campaign context
  theme               TEXT        NOT NULL,

  -- Selected assets (FK → client_assets; nullable for flexibility)
  hook_asset_id       UUID        REFERENCES public.client_assets(id) ON DELETE SET NULL,
  cta_asset_id        UUID        REFERENCES public.client_assets(id) ON DELETE SET NULL,
  -- Middle frames are an ordered list stored as array
  middle_asset_ids    UUID[]      NOT NULL DEFAULT '{}',

  -- Full scene breakdown with NZ/AU market context injected
  storyboard_json     JSONB       NOT NULL DEFAULT '{}'::JSONB,
  -- Shape: {
  --   scenes: [{ scene: number, role: "hook"|"middle"|"cta",
  --              asset_id: uuid, description: string }],
  --   market_context: string,  e.g. "Auckland NZ, family homeowners"
  --   brand_voice: string      injected from Brand Brief
  -- }

  -- Video prompts for each platform (editable by FDE)
  seedance_prompt     TEXT,
  kling_prompt        TEXT,
  runway_prompt       TEXT,

  -- Optional link back to a campaign or reels draft
  campaign_brief_id   UUID        REFERENCES public.campaign_briefs(id) ON DELETE SET NULL,
  reels_draft_id      UUID        REFERENCES public.reels_drafts(id) ON DELETE SET NULL,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_asset_storyboards_client
  ON public.asset_storyboards(client_id);

ALTER TABLE public.asset_storyboards ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_full" ON public.asset_storyboards
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TRIGGER asset_storyboards_updated_at
  BEFORE UPDATE ON public.asset_storyboards
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
