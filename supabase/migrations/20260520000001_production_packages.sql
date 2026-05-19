-- P13.A.1: Production Package 聚合层 — production_packages 表
-- 把六维诊断后的分散产物按维度 + 上下文聚合成可审核、可追溯、可归因的批次
-- Reference: ROADMAP.md § Phase 13, docs/production-package-rfc.md §4.1

-- ── Table ─────────────────────────────────────────────────────────────────────

CREATE TABLE production_packages (
  id                          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id                   UUID        NOT NULL REFERENCES clients(id)              ON DELETE CASCADE,
  master_brief_id             UUID        NOT NULL REFERENCES master_briefs(id)        ON DELETE RESTRICT,

  -- 六维 enum 复用（seo/ai_visibility/ads/social/reputation/competitor）
  dimension                   diagnostic_dimension NOT NULL,

  -- 显式来源 FK（全部可空，支持无上游链路的 ad-hoc 批次）
  campaign_id                 UUID        REFERENCES campaign_briefs(id)       ON DELETE SET NULL,
  diagnostic_run_id           UUID        REFERENCES diagnostic_runs(id)       ON DELETE SET NULL,
  diagnostic_finding_id       UUID        REFERENCES diagnostic_findings(id)   ON DELETE SET NULL,
  prescription_id             UUID        REFERENCES prescriptions(id)         ON DELETE SET NULL,
  execution_item_id           UUID        REFERENCES execution_items(id)       ON DELETE SET NULL,

  -- 非结构化来源占位（MVP 唯一 source 字段；后续可提升为 typed 字段）
  source_payload              JSONB       NOT NULL DEFAULT '{}',

  -- 生成时的上下文快照（可追溯，不随 master_brief / campaign 漂移）
  generation_context_snapshot JSONB       NOT NULL DEFAULT '{}',

  title                       TEXT        NOT NULL,
  brief                       TEXT,

  status                      TEXT        NOT NULL DEFAULT 'draft'
    CHECK (status IN (
      'draft', 'generating', 'ready_for_review', 'revision_requested',
      'approved', 'scheduled', 'published', 'measured', 'archived', 'failed'
    )),

  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Indexes ───────────────────────────────────────────────────────────────────

CREATE INDEX idx_pkg_client_dim      ON production_packages(client_id, dimension);
CREATE INDEX idx_pkg_status          ON production_packages(client_id, status);
CREATE INDEX idx_pkg_campaign        ON production_packages(campaign_id)       WHERE campaign_id       IS NOT NULL;
CREATE INDEX idx_pkg_execution_item  ON production_packages(execution_item_id) WHERE execution_item_id IS NOT NULL;

-- ── updated_at trigger ────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_production_packages_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER production_packages_updated_at_trigger
  BEFORE UPDATE ON production_packages
  FOR EACH ROW EXECUTE FUNCTION update_production_packages_updated_at();

-- ── RLS ───────────────────────────────────────────────────────────────────────

ALTER TABLE production_packages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full"
  ON production_packages FOR ALL TO service_role
  USING (true) WITH CHECK (true);
