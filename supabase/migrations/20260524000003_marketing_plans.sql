-- Phase 14.B: Marketing Plan 模块
-- 在 Master Brief × Campaign Brief 和具体内容生产之间，新增"营销计划"层。
-- Marketing Plan 定义"这个月做什么、做多少、什么节奏"，批准后批量派发任务到 Luban 执行看板。

-- ── Enums ─────────────────────────────────────────────────────────────────────

CREATE TYPE marketing_plan_status AS ENUM (
  'draft', 'approved', 'completed', 'archived'
);

-- execution_items 来源：诊断处方 vs 营销计划
-- 用 TEXT + CHECK 而不是 enum，方便未来扩展（如 'flywheel_autonomous'）
-- 注意：autonomous 飞轮行动目前用 sentinel prescription_id，本字段对它不影响

-- ── §1: marketing_plans ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS marketing_plans (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id         UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  campaign_id       UUID REFERENCES campaign_briefs(id) ON DELETE SET NULL,
  master_brief_id   UUID REFERENCES master_briefs(id) ON DELETE SET NULL,
  title             TEXT NOT NULL,
  status            marketing_plan_status NOT NULL DEFAULT 'draft',
  start_date        DATE,
  end_date          DATE,
  plan_data         JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- plan_data shape (validated in application layer):
  --   social: { facebook: {posts_per_week, reels_per_month, stories_per_week}, ... }
  --   blog:   { monthly_count, topics: [{title, keyword, due_week, source_strategy_item_id}] }
  --   kpis:   { social_engagement, blog_traffic, ai_visibility }
  --   tasks:  [{kind, platform, due_date, topic, source_blog_post_id}]
  generation_meta   JSONB,   -- {model, prompt_version, generation_cost_usd, generated_at}
  approved_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_marketing_plans_client_id     ON marketing_plans(client_id);
CREATE INDEX idx_marketing_plans_campaign_id   ON marketing_plans(campaign_id);
CREATE INDEX idx_marketing_plans_client_status ON marketing_plans(client_id, status);
CREATE INDEX idx_marketing_plans_created_at    ON marketing_plans(created_at DESC);

-- updated_at trigger
CREATE OR REPLACE FUNCTION update_marketing_plans_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER marketing_plans_updated_at_trigger
  BEFORE UPDATE ON marketing_plans
  FOR EACH ROW
  EXECUTE FUNCTION update_marketing_plans_updated_at();

-- RLS (service role bypasses RLS — same pattern as master_briefs / campaign_briefs)
ALTER TABLE marketing_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full"
  ON marketing_plans
  USING (true)
  WITH CHECK (true);

-- ── §2: 扩展 execution_items 支持 marketing_plan 来源 ──────────────────────────

-- 添加 source + marketing_plan_id 字段
ALTER TABLE execution_items
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'diagnostic',
  ADD COLUMN IF NOT EXISTS marketing_plan_id UUID REFERENCES marketing_plans(id) ON DELETE CASCADE;

-- 约束 source 取值
ALTER TABLE execution_items
  DROP CONSTRAINT IF EXISTS execution_items_source_check;
ALTER TABLE execution_items
  ADD CONSTRAINT execution_items_source_check
  CHECK (source IN ('diagnostic', 'marketing_plan'));

-- 允许 prescription_id 为空（marketing_plan 来源的任务不绑定 prescription）
ALTER TABLE execution_items
  ALTER COLUMN prescription_id DROP NOT NULL;

-- 保证至少有一个来源（互斥）
ALTER TABLE execution_items
  DROP CONSTRAINT IF EXISTS execution_items_source_consistency;
ALTER TABLE execution_items
  ADD CONSTRAINT execution_items_source_consistency
  CHECK (
    (source = 'diagnostic'     AND prescription_id IS NOT NULL AND marketing_plan_id IS NULL) OR
    (source = 'marketing_plan' AND marketing_plan_id IS NOT NULL AND prescription_id IS NULL)
  );

CREATE INDEX IF NOT EXISTS idx_execution_items_marketing_plan_id
  ON execution_items(marketing_plan_id);

CREATE INDEX IF NOT EXISTS idx_execution_items_client_source
  ON execution_items(client_id, source);

COMMENT ON COLUMN execution_items.source IS
  'Task origin: diagnostic (from prescription) or marketing_plan (from approved Marketing Plan)';

COMMENT ON COLUMN execution_items.marketing_plan_id IS
  'Set when source=marketing_plan. Mutually exclusive with prescription_id.';
