-- ============================================
-- Phase 21.B — reels_drafts storyboard traceability
-- Adds source_storyboard_id + middle_frame_urls
-- so "Send to Kanban" from Assets page has full data lineage.
-- 2026-06-12
-- ============================================

ALTER TABLE public.reels_drafts
  ADD COLUMN IF NOT EXISTS source_storyboard_id UUID
    REFERENCES public.asset_storyboards(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS middle_frame_urls TEXT[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS reels_drafts_storyboard_idx
  ON public.reels_drafts(source_storyboard_id)
  WHERE source_storyboard_id IS NOT NULL;

COMMENT ON COLUMN public.reels_drafts.source_storyboard_id IS
  'FK back to asset_storyboards — tracks which storyboard this draft was generated from';

COMMENT ON COLUMN public.reels_drafts.middle_frame_urls IS
  'Storage URLs of middle frame images selected in the storyboard (1–2 items)';
