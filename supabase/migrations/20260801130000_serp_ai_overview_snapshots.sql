-- 阶段 1 · SERP 深挖 (DataForSEO 接入计划)
-- spec: docs/superpowers/specs/2026-08-01-dataforseo-integration-plan.md § 阶段 1
--
-- 每周 SERP 采集把已付费买到的三样落库：AI Overview 出现/引用、
-- SERP 前 10 organic 域名（喂竞品支柱）。local_pack_rank 落在
-- keyword_snapshots 既有列，不在本表。
-- unique 约束照抄 keyword_snapshots 的 onConflict 口径。

CREATE TABLE IF NOT EXISTS serp_ai_overview_snapshots (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id           uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  keyword             text NOT NULL,
  location_code       integer NOT NULL,
  snapshot_date       date NOT NULL,
  has_ai_overview     boolean NOT NULL DEFAULT false,
  client_cited        boolean NOT NULL DEFAULT false,
  cited_sources       jsonb NOT NULL DEFAULT '[]'::jsonb,
  top_organic_domains jsonb NOT NULL DEFAULT '[]'::jsonb,
  measured_at         timestamptz NOT NULL DEFAULT now(),
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT serp_ai_overview_snapshots_unique
    UNIQUE (client_id, keyword, location_code, snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_serp_aio_snapshots_client_date
  ON serp_ai_overview_snapshots (client_id, snapshot_date DESC);

ALTER TABLE serp_ai_overview_snapshots ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service_role_full" ON serp_ai_overview_snapshots FOR ALL USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
