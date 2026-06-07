-- ============================================================================
-- DAPE Week 2 W4 — Prescription Goal 1:1 + Versioning
-- ============================================================================
--
-- Spec: docs/superpowers/specs/2026-06-08-me-dape-redefine-v0.2.md §2.3 + §5
--
-- BUG-FMT-F19/F20/F21 修法 (Phase 31 三层骨架对齐):
--   1. prescriptions 跟 goal 一对一 (新加 goal_id, 可空向后兼容)
--   2. 版本化 (supersedes_id 已有, 加 version int 方便 UI 渲染 v1/v2/v3)
--
-- 为什么 goal_id 可空:
--   - 旧处方 (Phase 8 时代) NULL = 未关联 Goal, UI 显示"未关联 Goal" badge
--   - DAPE 实施后新处方必填, API 层强制校验
--   - 不破坏 14 条历史处方 (CTS 1 approved + Oztop 1 approved 等)
--
-- Schema 改动: 1 列 (goal_id) + 1 列 (version) + 2 索引. 全可空可回滚.
-- Rollback: DROP COLUMN goal_id, version; DROP INDEX *_goal_id_idx;
-- ============================================================================

-- 1. goal_id 关联 (Phase 31 三层骨架对齐)
ALTER TABLE prescriptions
  ADD COLUMN IF NOT EXISTS goal_id UUID REFERENCES goals(id) ON DELETE SET NULL;

-- 2. 版本号 (UI 展示 v1/v2/v3, supersedes_id 链路推导用)
ALTER TABLE prescriptions
  ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1;

-- 3. 索引: "列出该 Goal 下所有处方版本"
CREATE INDEX IF NOT EXISTS idx_prescriptions_goal_id
  ON prescriptions(goal_id);

-- 4. 索引: "找 Goal 下最新版"
CREATE INDEX IF NOT EXISTS idx_prescriptions_goal_version
  ON prescriptions(goal_id, version DESC) WHERE goal_id IS NOT NULL;

-- 5. 注释 (留给后续 agent / FDE)
COMMENT ON COLUMN prescriptions.goal_id IS
  'Phase 31 strategy alignment: prescription belongs to one Goal. NULL for legacy pre-DAPE prescriptions. DAPE-era prescriptions API enforces non-null.';
COMMENT ON COLUMN prescriptions.version IS
  'Prescription version number under the same Goal. Auto-incremented in API layer on insert. supersedes_id chain references the actual prior row.';

-- RLS policy: 沿用 prescriptions 表已有 policy (service_role full access)
-- 不需要改 — service-role bearer-token 模式不依赖列级 RLS
