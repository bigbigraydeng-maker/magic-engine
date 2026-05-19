-- P13.D: Ads + Reputation 维度接入 production package
-- meta_ads_snapshots + project_reviews 各加 production_package_id nullable FK + partial index。
-- 设计原则：最小 schema 扩展，不改 production_items content_type CHECK 约束，
--           ads snapshot / reputation review 直接挂 package，不作为 production_item 行项。
-- Reference: ROADMAP.md § Phase 13.D

-- ── meta_ads_snapshots ────────────────────────────────────────────────────────

ALTER TABLE public.meta_ads_snapshots
  ADD COLUMN IF NOT EXISTS production_package_id UUID
    REFERENCES public.production_packages(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_meta_ads_snapshots_pkg
  ON public.meta_ads_snapshots(production_package_id)
  WHERE production_package_id IS NOT NULL;

-- ── project_reviews ───────────────────────────────────────────────────────────

ALTER TABLE public.project_reviews
  ADD COLUMN IF NOT EXISTS production_package_id UUID
    REFERENCES public.production_packages(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_project_reviews_pkg
  ON public.project_reviews(production_package_id)
  WHERE production_package_id IS NOT NULL;
