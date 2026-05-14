-- P8.12.S2.1: Case Library schema — 数据飞轮地基
-- 三张表让系统从历史客户学习（目前每次服务的数据「跑完就丢」，没有记忆）：
--   prescription_cases    — 「张骞→华佗」服务快照，按行业/危机类型/预算档可检索
--   prescription_outcomes — 处方批准后 30/60/90 天 KPI 实测值回流（效果反馈闭环）
--   local_data_cache      — 本地 connector 结果缓存，避免重复外部调用
-- 访问方式：仅通过 supabaseAdmin（service role）+ Bearer token API。
-- Reference: ROADMAP.md P8.12.S2.1

-- ── prescription_cases ───────────────────────────────────────────────────────
-- 一行 = 一次完整的「张骞发现 → 华佗处方」服务快照。
-- 索引 (industry_category, crisis_type, monthly_budget_aud) 支撑华佗
-- retrieve_similar_cases 的结构化检索（S2.2）。

CREATE TABLE IF NOT EXISTS prescription_cases (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id            UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  discovery_id         UUID NOT NULL REFERENCES client_discovery(id) ON DELETE CASCADE,
  prescription_id      UUID NOT NULL REFERENCES prescriptions(id) ON DELETE CASCADE,
  industry_category    TEXT,
  crisis_type          TEXT,
  monthly_budget_aud   INTEGER,
  market               TEXT CHECK (market IN ('AU', 'NZ')),
  business_size        TEXT,
  prescription_summary TEXT,
  self_grade_overall   NUMERIC,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_prescription_cases_lookup
  ON prescription_cases(industry_category, crisis_type, monthly_budget_aud);

ALTER TABLE prescription_cases ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service_role_full" ON prescription_cases FOR ALL USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON TABLE prescription_cases IS
  'P8.12.S2.1: 处方案例库 — 「张骞→华佗」服务快照，供华佗 retrieve_similar_cases 检索。';

-- ── prescription_outcomes ────────────────────────────────────────────────────
-- 效果反馈闭环：处方批准后 30/60/90 天的 KPI 实测值回流。
-- SEMrush 可测指标由 cron 自动回填（data_source='semrush_auto'），
-- 其余由 FDE 手工录入（data_source='manual_fde'）。

CREATE TABLE IF NOT EXISTS prescription_outcomes (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prescription_id      UUID NOT NULL REFERENCES prescriptions(id) ON DELETE CASCADE,
  case_id              UUID NOT NULL REFERENCES prescription_cases(id) ON DELETE CASCADE,
  client_id            UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  kpi_metric           TEXT NOT NULL,
  target_value         NUMERIC,
  actual_value         NUMERIC,
  unit                 TEXT,
  dimension            TEXT,
  measured_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  days_since_approval  INTEGER,
  data_source          TEXT CHECK (data_source IN ('semrush_auto', 'manual_fde')),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_prescription_outcomes_prescription
  ON prescription_outcomes(prescription_id);
CREATE INDEX IF NOT EXISTS idx_prescription_outcomes_case
  ON prescription_outcomes(case_id);

ALTER TABLE prescription_outcomes ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service_role_full" ON prescription_outcomes FOR ALL USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON TABLE prescription_outcomes IS
  'P8.12.S2.1: 效果反馈闭环 — 处方 KPI 30/60/90 天实测值回流。';

-- ── local_data_cache ─────────────────────────────────────────────────────────
-- 本地 connector（ABR / local-reviews / gtrends 等）结果缓存。
-- cache_key 唯一（UNIQUE 约束自带 btree 索引）；expires_at 控制 TTL。

CREATE TABLE IF NOT EXISTS local_data_cache (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cache_key   TEXT NOT NULL UNIQUE,
  connector   TEXT NOT NULL,
  market      TEXT,
  payload     JSONB NOT NULL,
  fetched_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_local_data_cache_expires_at
  ON local_data_cache(expires_at);

ALTER TABLE local_data_cache ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service_role_full" ON local_data_cache FOR ALL USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON TABLE local_data_cache IS
  'P8.12.S2.1: 本地 connector 结果缓存（cache_key 唯一，expires_at 控制 TTL）。';
