-- Phase 23.A — Cross-Agent Memory Layer: L3 长期学习表
--
-- 新增 4 张表构成 L3 记忆层（client_learned_preferences / client_proven_patterns /
-- client_failed_experiments / client_decision_history），配合现有的 L1（luban_messages）
-- 和 L2（zhuge_sessions）形成完整三层记忆体系。
--
-- 设计原则：
--   - 仅 FDE 可见/可编辑，不暴露给客户
--   - 不依赖向量数据库；pgvector 扩展已够用，但本期只用 JSON+text 全文检索
--   - 向后兼容：不修改任何现有表
--   - auto_extract 路径留 extracted_from 指针，人工标注路径 source='fde_annotation'

-- ── 1. client_learned_preferences ────────────────────────────────────────────
-- FDE 标注 + 客户反馈累积：记录该客户的内容风格、话题偏好、格式要求等长期偏好。
CREATE TABLE IF NOT EXISTS client_learned_preferences (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id        UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,

  -- 偏好类型：style（写作风格）/ topic（话题范围）/ format（内容格式）/ tone（语调）/ audience（目标受众）
  preference_type  TEXT NOT NULL CHECK (
    preference_type IN ('style', 'topic', 'format', 'tone', 'audience', 'other')
  ),

  -- 偏好内容，自由文本，例如："客户喜欢用数据支撑论点，每篇至少引用 2 个统计数字"
  content          TEXT NOT NULL,

  -- 来源
  source           TEXT NOT NULL DEFAULT 'fde_annotation' CHECK (
    source IN ('fde_annotation', 'client_feedback', 'auto_extracted')
  ),

  -- auto_extracted 时：记录从哪条 flywheel_outcome / generation 提取的
  extracted_from_table TEXT,
  extracted_from_id    UUID,

  -- 0.0–1.0，auto_extracted 时由算法给出；fde_annotation 默认 1.0
  confidence_score NUMERIC(3,2) NOT NULL DEFAULT 1.0
    CHECK (confidence_score >= 0.0 AND confidence_score <= 1.0),

  -- 适用飞轮（null = 全飞轮通用）
  flywheel         TEXT CHECK (flywheel IN ('seo', 'geo', 'ads', 'social')),

  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_clp_client_active
  ON client_learned_preferences(client_id, is_active, preference_type);

-- ── 2. client_proven_patterns ─────────────────────────────────────────────────
-- 该客户跑赢过的 hook / 角度 / CTA / 格式：累积成功经验供 AI Factory 复用。
CREATE TABLE IF NOT EXISTS client_proven_patterns (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id        UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,

  -- 模式类型
  pattern_type     TEXT NOT NULL CHECK (
    pattern_type IN ('hook', 'cta', 'angle', 'format', 'headline', 'structure')
  ),

  -- 具体模式描述，例如："以提问开头的 hook 比陈述句点击率高 32%"
  pattern_content  TEXT NOT NULL,

  -- 可量化指标（可选），例如："CTR 提升 32%", "Avg session +45s"
  performance_metric TEXT,
  measurement_period_start DATE,
  measurement_period_end   DATE,

  flywheel         TEXT CHECK (flywheel IN ('seo', 'geo', 'ads', 'social')),

  -- 关联来源（可选）：blog_posts.id / execution_items.id 等
  source_table     TEXT,
  source_id        UUID,

  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cpp_client_flywheel
  ON client_proven_patterns(client_id, flywheel, is_active);

-- ── 3. client_failed_experiments ─────────────────────────────────────────────
-- 失败实验记录：避免诸葛亮重复推荐已知无效的方向。
CREATE TABLE IF NOT EXISTS client_failed_experiments (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id        UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,

  -- 失败实验的简要描述
  experiment_description TEXT NOT NULL,

  -- 失败原因
  failure_reason   TEXT NOT NULL,

  -- 关联诊断维度
  dimension        TEXT CHECK (
    dimension IN ('seo', 'ai_visibility', 'ads', 'social', 'reputation', 'competitor')
  ),

  -- 实验发生的时间
  tried_at         TIMESTAMPTZ,

  -- 关联来源（可选）
  source_table     TEXT,
  source_id        UUID,

  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cfe_client_dimension
  ON client_failed_experiments(client_id, dimension);

-- ── 4. client_decision_history ────────────────────────────────────────────────
-- 诸葛亮决策历史：记录每次"为什么选 X 不选 Y"，供后续会话注入历史决策上下文。
CREATE TABLE IF NOT EXISTS client_decision_history (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id        UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,

  -- 对应诸葛亮会话（可选，用于溯源）
  zhuge_session_id UUID REFERENCES zhuge_sessions(id) ON DELETE SET NULL,

  -- 决策背景（简述），例如："本次 SEO 分数 42，GEO 分数 18"
  decision_context TEXT NOT NULL,

  -- 最终选择的行动类型
  chosen_action    TEXT NOT NULL,

  -- 被排除的候选（JSON array of strings），例如：["fix_meta_titles", "pause_losing_kw"]
  alternatives_rejected JSONB NOT NULL DEFAULT '[]',

  -- 选择理由（供下次注入）
  reasoning        TEXT NOT NULL,

  -- 执行结果（outcome，由 Phase 23.C 自动抽取器回填）
  outcome_verdict  TEXT CHECK (outcome_verdict IN ('success', 'failure', 'inconclusive')),
  outcome_notes    TEXT,

  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cdh_client_session
  ON client_decision_history(client_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_cdh_zhuge_session
  ON client_decision_history(zhuge_session_id)
  WHERE zhuge_session_id IS NOT NULL;

-- ── updated_at 触发器 ─────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'set_updated_at_clp'
  ) THEN
    CREATE TRIGGER set_updated_at_clp
      BEFORE UPDATE ON client_learned_preferences
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'set_updated_at_cpp'
  ) THEN
    CREATE TRIGGER set_updated_at_cpp
      BEFORE UPDATE ON client_proven_patterns
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END;
$$;
