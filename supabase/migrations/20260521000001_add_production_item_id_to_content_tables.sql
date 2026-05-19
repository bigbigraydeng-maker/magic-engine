-- P13.A.3: 为四张内容表各加 production_item_id FK + index
-- 方向：内容表 → production_items（反向查询用）
-- production_items 已有 → 内容表的 FK，这里加反向 nullable FK 方便从内容行直接找归属 package
-- Reference: ROADMAP.md § Phase 13.A

-- ── content_posts ─────────────────────────────────────────────────────────────

ALTER TABLE public.content_posts
  ADD COLUMN IF NOT EXISTS production_item_id UUID
    REFERENCES public.production_items(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_content_posts_production_item
  ON public.content_posts(production_item_id)
  WHERE production_item_id IS NOT NULL;

-- ── blog_posts ─────────────────────────────────────────────────────────────────

ALTER TABLE public.blog_posts
  ADD COLUMN IF NOT EXISTS production_item_id UUID
    REFERENCES public.production_items(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_blog_posts_production_item
  ON public.blog_posts(production_item_id)
  WHERE production_item_id IS NOT NULL;

-- ── reels_drafts ───────────────────────────────────────────────────────────────

ALTER TABLE public.reels_drafts
  ADD COLUMN IF NOT EXISTS production_item_id UUID
    REFERENCES public.production_items(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_reels_drafts_production_item
  ON public.reels_drafts(production_item_id)
  WHERE production_item_id IS NOT NULL;

-- ── visual_assets ──────────────────────────────────────────────────────────────

ALTER TABLE public.visual_assets
  ADD COLUMN IF NOT EXISTS production_item_id UUID
    REFERENCES public.production_items(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_visual_assets_production_item
  ON public.visual_assets(production_item_id)
  WHERE production_item_id IS NOT NULL;
