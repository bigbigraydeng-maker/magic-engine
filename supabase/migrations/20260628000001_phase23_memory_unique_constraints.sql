-- Phase 23 补丁：给 memory 表加 DB 级唯一约束
--
-- 问题：extractor.ts 靠应用层 Set 去重，但 Set 在 loadExistingSourceIds 失败时
-- 会降级为空 Set，导致重复写入（已发现 client_proven_patterns 有 2 条相同记录）。
-- 修复：在 DB 层加 UNIQUE 约束，配合 extractor 改用 upsert + onConflict='ignore'。
--
-- 注意：先清理已有重复行，再加约束。
-- Reference: ROADMAP.md Phase 23 / 魏征审查报告 2026-06-06

BEGIN;

-- ── 1. 清理 client_proven_patterns 重复行 ──────────────────────────────────────
-- 保留每组 (client_id, source_table, source_id) 中 created_at 最早的一条
DELETE FROM client_proven_patterns
WHERE id NOT IN (
  SELECT DISTINCT ON (client_id, source_table, source_id) id
  FROM client_proven_patterns
  WHERE source_table IS NOT NULL AND source_id IS NOT NULL
  ORDER BY client_id, source_table, source_id, created_at ASC
);

-- ── 2. 清理 client_failed_experiments 重复行 ───────────────────────────────────
DELETE FROM client_failed_experiments
WHERE id NOT IN (
  SELECT DISTINCT ON (client_id, source_table, source_id) id
  FROM client_failed_experiments
  WHERE source_table IS NOT NULL AND source_id IS NOT NULL
  ORDER BY client_id, source_table, source_id, created_at ASC
);

-- ── 3. 加唯一约束（仅对有 source_id 的行生效，NULL 不参与唯一判断）─────────────
ALTER TABLE client_proven_patterns
  ADD CONSTRAINT uq_cpp_client_source
  UNIQUE (client_id, source_table, source_id);

ALTER TABLE client_failed_experiments
  ADD CONSTRAINT uq_cfe_client_source
  UNIQUE (client_id, source_table, source_id);

-- ── RLS（沿用 service_role 模板，无变更）─────────────────────────────────────────
-- 两张表已在 20260610000001 中建立 RLS，本 migration 不重复设置。

COMMIT;
