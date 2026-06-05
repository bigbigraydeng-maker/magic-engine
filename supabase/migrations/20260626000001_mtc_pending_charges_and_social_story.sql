-- ============================================
-- MTC pending charges + social_story service key
-- 2026-06-26  Phase X.S1 — Wire content generation to MTC
-- ============================================
--
-- 1. reels_drafts: track projected MTC + service key so the async worker
--    (video-status polling) can commitCharge on success / refund on failure.
--    All three columns are nullable so legacy rows generated before this
--    migration continue to work (skip the commit step).
--
-- 2. blog_posts: same pattern — blog generation is fire-and-forget background,
--    POST returns immediately. The background task commits/refunds on resolve.
--
-- 3. ai_factory_post is already wired (Phase 21.6/21.8); no change there.

-- ── 1. reels_drafts pending-charge fields ─────────────────────────────────────
ALTER TABLE public.reels_drafts
  ADD COLUMN IF NOT EXISTS mtc_service_key TEXT,
  ADD COLUMN IF NOT EXISTS mtc_projected   INTEGER,
  ADD COLUMN IF NOT EXISTS mtc_committed   BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.reels_drafts.mtc_service_key IS
  'MTC ServiceKey for the in-flight video job (e.g. reels_720p_15s). Set when generate-video is called.';
COMMENT ON COLUMN public.reels_drafts.mtc_projected IS
  'Projected MTC cost validated upfront; committed on completion, refunded on failure.';
COMMENT ON COLUMN public.reels_drafts.mtc_committed IS
  'True once commitCharge or refundOnFail has run for this draft — prevents double-charging on poll retries.';

-- ── 2. blog_posts pending-charge fields ───────────────────────────────────────
ALTER TABLE public.blog_posts
  ADD COLUMN IF NOT EXISTS mtc_service_key TEXT,
  ADD COLUMN IF NOT EXISTS mtc_projected   INTEGER,
  ADD COLUMN IF NOT EXISTS mtc_committed   BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.blog_posts.mtc_service_key IS
  'MTC ServiceKey for the in-flight blog generation (blog_seo or blog_dual_signal).';
COMMENT ON COLUMN public.blog_posts.mtc_projected IS
  'Projected MTC cost validated upfront; committed on draft ready, refunded on status=failed.';
COMMENT ON COLUMN public.blog_posts.mtc_committed IS
  'True once commitCharge or refundOnFail has run — prevents double-charging.';
