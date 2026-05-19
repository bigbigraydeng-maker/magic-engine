-- P13.E-pre: Competitor snapshot persistence + production_package_id 接入
-- semrush/competitor-keywords 当前无状态 GET；本 migration 新增 competitor_snapshots 表，
-- 让每次竞品关键词拉取留下可追溯快照，并可挂载到生产包维度（dimension='competitor'）。
-- Reference: ROADMAP.md § Phase 13.E-pre

CREATE TABLE public.competitor_snapshots (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id             UUID        NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  production_package_id UUID        REFERENCES public.production_packages(id) ON DELETE SET NULL,

  -- 本次查询的参数快照（可追溯）
  competitor_domains    TEXT[]      NOT NULL,
  semrush_db            TEXT        NOT NULL DEFAULT 'au',
  min_volume            INT         NOT NULL DEFAULT 100,

  -- 结果摘要（不存全量，全量已落 keywords 表）
  keywords_count        INT         NOT NULL DEFAULT 0,
  units_consumed        INT         NOT NULL DEFAULT 0,

  -- top_keywords 存前 50 条摘要（keyword + volume + kd），供 package 详情页快速展示
  top_keywords          JSONB       NOT NULL DEFAULT '[]',

  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_competitor_snapshots_client
  ON public.competitor_snapshots(client_id, created_at DESC);

CREATE INDEX idx_competitor_snapshots_pkg
  ON public.competitor_snapshots(production_package_id)
  WHERE production_package_id IS NOT NULL;

ALTER TABLE public.competitor_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full"
  ON public.competitor_snapshots FOR ALL TO service_role
  USING (true) WITH CHECK (true);
