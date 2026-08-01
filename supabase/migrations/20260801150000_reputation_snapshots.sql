-- 阶段 2 · 口碑支柱 0→1 (DataForSEO 接入计划)
-- spec: docs/superpowers/specs/2026-08-01-dataforseo-integration-plan.md § 阶段 2
--
-- ① clients 加口碑监测身份字段（写入路径 = Settings 页 UI，运营不碰数据库）
-- ② reputation_snapshots：客户 + 竞品的每周评分/评论数快照
-- ③ review_items：评论明细（全库此前没有任何评价明细表）
-- 范围铁律：本阶段只落快照，不动华佗 scoreReputation 生产路径（切源独立 PR）。

-- ── ① 身份字段 ────────────────────────────────────────────────────────────────

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS gbp_place_id text,
  ADD COLUMN IF NOT EXISTS tripadvisor_keyword text,
  ADD COLUMN IF NOT EXISTS competitor_gbp jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN clients.gbp_place_id IS '客户自己的 Google 商家 place_id（口碑监测精确身份）';
COMMENT ON COLUMN clients.tripadvisor_keyword IS 'Tripadvisor 搜索词（旅游类客户，如 "CTS Tours New Zealand"）；空 = 不拉 Tripadvisor';
COMMENT ON COLUMN clients.competitor_gbp IS '竞品 GBP 身份数组 [{"name":"...","place_id":"..."}]，与 competitor_domains 同页配置';

-- ── ② 每周快照 ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS reputation_snapshots (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  entity_type   text NOT NULL CHECK (entity_type IN ('client', 'competitor')),
  entity_name   text NOT NULL,
  place_id      text,
  source        text NOT NULL CHECK (source IN ('gbp', 'tripadvisor', 'trustpilot')),
  rating        numeric(3,2),
  review_count  integer,
  snapshot_date date NOT NULL,
  measured_at   timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reputation_snapshots_unique
    UNIQUE (client_id, entity_type, entity_name, source, snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_reputation_snapshots_client_date
  ON reputation_snapshots (client_id, snapshot_date DESC);

ALTER TABLE reputation_snapshots ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service_role_full" ON reputation_snapshots FOR ALL USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── ③ 评论明细 ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS review_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  entity_type   text NOT NULL CHECK (entity_type IN ('client', 'competitor')),
  entity_name   text NOT NULL,
  source        text NOT NULL CHECK (source IN ('gbp', 'tripadvisor', 'trustpilot')),
  -- API review_id，拿不到时用 (author+date+文本前缀) 哈希兜底 —— 去重键
  review_uid    text NOT NULL,
  author        text,
  rating        integer,
  text          text,
  review_date   timestamptz,
  -- 本轮采集新出现的评论 = true；下轮采集开始时统一翻 false（"本周新增"语义）
  is_new        boolean NOT NULL DEFAULT true,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT review_items_unique
    UNIQUE (client_id, entity_type, entity_name, source, review_uid)
);

CREATE INDEX IF NOT EXISTS idx_review_items_client_new
  ON review_items (client_id, is_new, first_seen_at DESC);

ALTER TABLE review_items ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service_role_full" ON review_items FOR ALL USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
