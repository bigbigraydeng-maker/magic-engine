-- ============================================
-- Phase 12.Q.0 — Content quality snapshot + score columns
-- 2026-05-25  P12.Q.0
-- Adds generation_context_snapshot + quality_score to all three content
-- artifact tables so quality rubric results can be persisted after generation.
-- ============================================

ALTER TABLE public.blog_posts
  ADD COLUMN IF NOT EXISTS generation_context_snapshot JSONB NULL,
  ADD COLUMN IF NOT EXISTS quality_score NUMERIC(4,2) NULL
    CHECK (quality_score IS NULL OR quality_score BETWEEN 0 AND 10);

ALTER TABLE public.content_posts
  ADD COLUMN IF NOT EXISTS generation_context_snapshot JSONB NULL,
  ADD COLUMN IF NOT EXISTS quality_score NUMERIC(4,2) NULL
    CHECK (quality_score IS NULL OR quality_score BETWEEN 0 AND 10);

ALTER TABLE public.reels_drafts
  ADD COLUMN IF NOT EXISTS generation_context_snapshot JSONB NULL,
  ADD COLUMN IF NOT EXISTS quality_score NUMERIC(4,2) NULL
    CHECK (quality_score IS NULL OR quality_score BETWEEN 0 AND 10);
