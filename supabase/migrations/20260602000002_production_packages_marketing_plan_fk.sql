-- Link production_packages back to the marketing plan that generated them.
-- Enables direct query: "which packages were auto-created from this plan?"
-- Previously only reachable via execution_items (many-to-one) — too indirect.

ALTER TABLE production_packages
  ADD COLUMN IF NOT EXISTS marketing_plan_id UUID
    REFERENCES marketing_plans(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_production_packages_marketing_plan_id
  ON production_packages(marketing_plan_id)
  WHERE marketing_plan_id IS NOT NULL;
