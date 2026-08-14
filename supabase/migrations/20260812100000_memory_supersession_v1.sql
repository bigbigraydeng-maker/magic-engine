-- Memory supersession v1 — 让「有效」和「无效」两条相反经验不可能同时生效
--
-- Issue #859 架构判断 6（Memory 修复尚未最终定案）落地。
--
-- 问题（2026-08-12 在 main 上复核仍成立）:
--
--   PR #862 把 flywheel_outcomes 从「每次跑都 DELETE + INSERT」改成按自然键
--   upsert（job.ts::upsertOutcome），outcome.id 因此是稳定的。稳定身份修好了
--   「每天造一份副本」，但把另一个问题放大了：同一行 outcome 现在会被原地
--   UPDATE，verdict 可以从 confirmed 翻成 reversed，再翻回来。
--
--   memory/extractor.ts 对这条翻转毫无反应：
--     - confirmed → 写 client_proven_patterns
--     - reversed  → 写 client_failed_experiments
--     - 两次都写完之后，两条互相矛盾的经验同时被 agent 读到
--     - client_failed_experiments 连 is_active 都没有，想关都关不掉
--
--   三张 L3 记忆表的生命周期字段本来就不对称（20260610000001 建表时就是）：
--     client_learned_preferences  is_active ✓  updated_at ✓
--     client_proven_patterns      is_active ✓  updated_at ✓
--     client_failed_experiments   ✗            ✗
--
-- 本 migration 做三件事，全部是「扩」不是「收」，不拒绝任何现有写入:
--
--   1. 给 client_failed_experiments 补上 is_active / updated_at，三表对齐。
--      现有行默认 is_active = TRUE —— 今天读侧根本没有过滤，所有行本来就都在
--      被读，默认 TRUE 才是「行为不变」。
--
--   2. 两张派生记忆表补 source_action_id（动作身份）。
--      去重与互斥的正确单位是**动作**，不是 outcome 行：一个动作在一次快照里
--      同时产出 clicks / impressions / avg_position 三行 outcome，双窗口再翻倍。
--      按 outcome.id 去重会让一个动作留下多条记忆；而且代表行一旦变化（窗口更
--      长了、expected_metric 改了），换个 source_id 又会再写一条。
--      不改 source_id 的含义（它仍是 outcome.id，21 条存量数据不被重新解释），
--      改为新增一列显式存动作身份。存量行该列为 NULL = legacy，不被自动触碰。
--
--   3. 跨表互斥触发器：同一个 (client_id, source_action_id) 上，一旦一侧被
--      激活，另一侧自动下架。
--      为什么用触发器而不是只在 extractor 里写 if —— Issue #859 判断 3:
--      「授权不能只是 executor 里『记得调用的 if』」。写这两张表的不止 extractor，
--      还有 FDE 标注接口（/api/clients/[id]/memory/annotate）。放在 DB 层，
--      任何写入方都绕不过去。
--      FDE 手工标注不带 source_action_id（NULL），永远不会被自动下架。
--
-- 明确不做（留给后续、需要 PM 单独授权的动作）:
--   - 不建 UNIQUE 约束。加约束属于「收」，按仓库规矩必须独立 PR，且要先在生产
--     查过没有存量冲突才能加。本次无生产读权限（见 PR 说明）。
--   - 不清理存量 legacy 记忆行。那属于数据修复，#870 明确写了不在实现授权范围内。
--   - 不调度 memory-extractor。enablement 是单独一个 PR（#859 处理方向第 3 条）。

-- ── 1. client_failed_experiments 补齐生命周期字段 ─────────────────────────────

ALTER TABLE client_failed_experiments
  ADD COLUMN IF NOT EXISTS is_active  BOOLEAN     NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- 与另两张表的索引形状对齐（client + 生效状态 + 分类维度）
CREATE INDEX IF NOT EXISTS idx_cfe_client_active
  ON client_failed_experiments(client_id, is_active, dimension);

-- ── 2. 动作身份列 ─────────────────────────────────────────────────────────────

ALTER TABLE client_proven_patterns
  ADD COLUMN IF NOT EXISTS source_action_id UUID;

ALTER TABLE client_failed_experiments
  ADD COLUMN IF NOT EXISTS source_action_id UUID;

-- 刻意不加 REFERENCES flywheel_actions(id)：记忆是「学到的东西」，不该因为执行
-- 记录被清理就跟着消失。外键会把记忆的存活绑在执行表上，方向反了。
CREATE INDEX IF NOT EXISTS idx_cpp_source_action
  ON client_proven_patterns(client_id, source_action_id)
  WHERE source_action_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cfe_source_action
  ON client_failed_experiments(client_id, source_action_id)
  WHERE source_action_id IS NOT NULL;

-- ── 3. updated_at 触发器（复用 20260610000001 建的函数）───────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_cfe') THEN
    CREATE TRIGGER set_updated_at_cfe
      BEFORE UPDATE ON client_failed_experiments
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END;
$$;

-- ── 4. 跨表互斥 ───────────────────────────────────────────────────────────────

-- 一侧被激活 → 另一侧同动作的经验下架。
--
-- 不会递归：下架走的是 is_active = FALSE，而触发器的 WHEN 只在 NEW.is_active
-- 为 TRUE 时才成立，所以被下架的那一侧不会反过来再触发一次。
CREATE OR REPLACE FUNCTION memory_supersede_counterpart()
RETURNS TRIGGER AS $$
DECLARE
  counterpart TEXT;
BEGIN
  -- 没有动作身份就是 FDE 手工标注 / 存量行，不参与自动互斥
  IF NEW.source_action_id IS NULL THEN
    RETURN NEW;
  END IF;

  counterpart := CASE TG_TABLE_NAME
    WHEN 'client_proven_patterns'     THEN 'client_failed_experiments'
    WHEN 'client_failed_experiments'  THEN 'client_proven_patterns'
  END;

  IF counterpart IS NULL THEN
    RETURN NEW;
  END IF;

  EXECUTE format(
    'UPDATE %I SET is_active = FALSE
      WHERE client_id = $1 AND source_action_id = $2 AND is_active',
    counterpart
  ) USING NEW.client_id, NEW.source_action_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'supersede_from_pattern') THEN
    CREATE TRIGGER supersede_from_pattern
      AFTER INSERT OR UPDATE OF is_active ON client_proven_patterns
      FOR EACH ROW WHEN (NEW.is_active)
      EXECUTE FUNCTION memory_supersede_counterpart();
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'supersede_from_experiment') THEN
    CREATE TRIGGER supersede_from_experiment
      AFTER INSERT OR UPDATE OF is_active ON client_failed_experiments
      FOR EACH ROW WHEN (NEW.is_active)
      EXECUTE FUNCTION memory_supersede_counterpart();
  END IF;
END;
$$;
