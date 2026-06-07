-- ============================================================================
-- DAPE Week 2 W4 — Backfill prescriptions.goal_id (DO NOT RUN BLINDLY)
-- ============================================================================
--
-- Spec: docs/superpowers/specs/2026-06-08-me-dape-redefine-v0.2.md §2.3
--
-- 目的: 把现有 6 条 approved 处方关联到 client 的某个 active Goal.
-- 注意:
--   1. **PM 必须先 review 每个映射决定**再跑. 不要无脑批量 UPDATE.
--   2. 14 条历史处方里 6 条 approved (CTS 1 / Oztop 1 / IB Real Estate 1 / Newaisan 1 /
--      Magic Lab 1 / Magic Lab Class 1 / Dixon Homes 1), 其余 draft/failed/test 不动.
--   3. 若客户没有 active Goal, 先在 ME UI 建 Goal 再跑此脚本.
--   4. version 默认 1 (DB default), 不需手动设.
--   5. supersedes_id 链路保持不变.
--
-- 如何用:
--   - 复制到 Supabase Studio SQL 编辑器
--   - **一条一条 SELECT 验证后, 再一条一条 UPDATE**
--   - 不要批量执行
--
-- ============================================================================

-- ─── Step 0: 当前 schema 验证 (必跑确认 migration 已 apply) ────────────────────
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'prescriptions' AND column_name IN ('goal_id', 'version');
-- 预期: 2 行 (goal_id uuid, version integer)


-- ─── Step 1: 列出所有 approved 处方 + client 信息 (review 用) ──────────────────
SELECT
  p.id              AS prescription_id,
  c.name            AS client_name,
  p.client_id,
  p.created_at,
  p.intake->>'business_goal' AS prescription_goal_text,
  p.intake->>'monthly_budget_aud' AS budget,
  p.goal_id         AS current_goal_id   -- 应该都是 NULL
FROM prescriptions p
LEFT JOIN clients c ON c.id = p.client_id
WHERE p.status = 'approved'
ORDER BY c.name, p.created_at DESC;


-- ─── Step 2: 列出客户的 active Goals (映射决策依据) ───────────────────────────
SELECT
  g.id              AS goal_id,
  c.name            AS client_name,
  g.title           AS goal_title,
  g.intent,
  g.sub_type,
  g.period_start,
  g.period_end
FROM goals g
LEFT JOIN clients c ON c.id = g.client_id
WHERE g.status = 'active'
  AND g.title != '[Migration] Unassigned Backlog'
ORDER BY c.name, g.created_at DESC;


-- ─── Step 3: CTS Tours NZ — 1 处方 → 哪个 Goal? ─────────────────────────────
--
-- CTS 4 active goals: 品牌搜索量提升 / 自然流增长 / AI 可见度提升 / 2026 Best of China
-- 处方 21ed9a3c-95d5-4b90-9a6e-2a5194e97c11 文案: "3个月内曝光和销售需要用鸥大幅增长!"
-- → 看起来最接近"自然流增长" (c5816200-6a3b-45f7-8989-3f3f2aee46f7)
--    或 "Best of China 团报名" (7e6d6ff0-f8c0-4e61-843a-ba5aa81843f5)
-- ⚠️ **PM 拍**:
--
-- PM 选完后跑:
-- UPDATE prescriptions
-- SET goal_id = '<PM_PICKED_GOAL_ID>'
-- WHERE id = '21ed9a3c-95d5-4b90-9a6e-2a5194e97c11'
--   AND client_id = 'c0000000-0000-0000-0000-000000000000';


-- ─── Step 4: Oztop — 1 处方 → 哪个 Goal? ────────────────────────────────────
--
-- Oztop 4 active goals: Brisbane品牌曝光 / AI 可见度提升 / 自然流量增长 / Walnut 地板清仓
-- 处方 cda6aec9-180a-41a8-a94d-a99646cd1e39 文案: "3个月内产生15位flooring客户, 人均客单价5000澳币"
-- → flooring 客户获客, 跟现有 4 个 awareness Goal 都不完全匹配
-- → 建议: 先建一个新 acquisition Goal "Brisbane flooring 月询盘 15", 再 backfill
-- ⚠️ **PM 拍** (有 3 个选择):
--    A. 直接选 Walnut 地板清仓 (沾边但不准确)
--    B. 建新 Goal 后 backfill (最干净)
--    C. 留 NULL (legacy, 不影响 DAPE-era 新流程)
--
-- 假设走 B 方案:
-- 1. PM 在 ME UI 创建 Oztop 新 Goal "Brisbane flooring 月询盘 15 客户"
-- 2. 复制新 goal_id
-- 3. UPDATE prescriptions
--    SET goal_id = '<NEW_GOAL_ID>'
--    WHERE id = 'cda6aec9-180a-41a8-a94d-a99646cd1e39'
--      AND client_id = 'd5c98811-1c1d-4ded-bdf0-4cefec6afb84';


-- ─── Step 5: 其他 4 客户的 approved 处方 ────────────────────────────────────
--
-- IB Real Estate (3a855a6f-4dbc-488d-96bf-b5e6a7558757):
--   f9bbf35d-5e61-45ca-8451-2a062846b49f "第三季度卖出去5套200万澳币的房产"
--   → 没有 active Goal, 留 NULL 或建新 Goal
--
-- Newaisan (4ae76381-cd45-43bd-85cd-98cfd7604007):
--   36b8224b-f86d-4cc4-836d-a77d17f95fc2 "三个月内提升全网曝光, 针对3pl业务拓展更多的澳洲和中国客户"
--   → 没有 active Goal, 留 NULL 或建新 Goal
--
-- Magic Lab (5e9d67f2-0ffe-4093-95ca-54c9e713d9bf):
--   2e22846c-a4ef-4244-9c2a-8ae533788531 "在未来3个月内完成数字媒体的搭建, 获得更多品牌曝光"
--   → 没有 active Goal, 留 NULL 或建新 Goal
--
-- Magic Lab Class (377468af-b103-45f0-984a-b353febb56a1):
--   a606a897-e46e-49af-8646-b856c337bd75 "在1个月内, 拥有500个subscribers"
--   → 没有 active Goal, 留 NULL 或建新 Goal
--
-- Dixon Homes (85fded24-56d7-4ffd-9ba7-42ae2f417d83):
--   3930bbb8-aba6-42fa-afc5-2b8bd0d68ff0 "扩大更多客户"
--   → 没有 active Goal, 留 NULL 或建新 Goal


-- ─── Step 6: 验证 backfill 后状态 ───────────────────────────────────────────
SELECT
  c.name            AS client_name,
  COUNT(p.id) FILTER (WHERE p.status = 'approved')                                          AS approved_total,
  COUNT(p.id) FILTER (WHERE p.status = 'approved' AND p.goal_id IS NOT NULL)                AS approved_with_goal,
  COUNT(p.id) FILTER (WHERE p.status = 'approved' AND p.goal_id IS NULL)                    AS approved_legacy_null
FROM prescriptions p
LEFT JOIN clients c ON c.id = p.client_id
GROUP BY c.name
ORDER BY c.name;


-- ─── Step 7: 全表健康检查 ───────────────────────────────────────────────────
SELECT
  status,
  COUNT(*)                                       AS row_count,
  COUNT(goal_id)                                 AS with_goal_id,
  COUNT(*) - COUNT(goal_id)                      AS without_goal_id,
  MIN(version)                                   AS min_version,
  MAX(version)                                   AS max_version
FROM prescriptions
GROUP BY status
ORDER BY status;


-- ============================================================================
-- 回滚: 不需要单独脚本. SET goal_id = NULL WHERE id = '<id>' 即可恢复.
-- ============================================================================
