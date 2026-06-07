# DAPE W5 — execution_items.prescription_id Backfill SOP

> **状态**：待狄仁杰审 → PM 拍板后跑（DO NOT RUN BLIND）
> **影响**：CTS 87 Kanban 卡片 + Oztop n 卡片
> **回滚成本**：低（UPDATE 单字段，无 DELETE / 无 ALTER）
> **关联**：[Spec §2.4.3](../superpowers/specs/2026-06-08-me-dape-redefine-v0.2.md) · [migration 20260628000001](../../supabase/migrations/20260628000001_dape_w5_execution_prescription_link.sql)

## 1. 背景

DAPE Week 3 W5 修 BUG-FMT-F22：execution_items 的 P→E 归因链断。

migration `20260628000001` 已放松 source_consistency 约束，让 zhuge / luban / proactive_signal / fde / fde_manual source 可以**选填** prescription_id。但**老数据仍然 NULL**（旧约束强制 NULL）。

本 SOP 把可以追溯到 prescription 的老卡片填上 prescription_id，让 Kanban prescription filter 能起作用、让飞轮闭环数据回流到处方。

## 2. 范围与不动原则

- **只 UPDATE 已有 execution_items.prescription_id**，不 INSERT 不 DELETE
- **只填 NULL → uuid**，不覆盖已有非 NULL 值
- **不动 source='diagnostic'** 行（这些行已有 prescription_id，本来就走旧路径）
- **不动 source='marketing_plan'** 行（marketing_plan_id 是它的 anchor，按 DAPE §2.4.2 设计不挂到 prescription_id）
- **保留所有现有 CTS 87 卡片**，不许丢失一条

## 3. 反查链路（spec §2.4.4 + 实际表结构）

```
execution_items
  → (initiative_id)
    → initiatives
        → (goal_id)
          → goals
            → (?)
              → 没有直接 FK 到 prescriptions
```

但是 prescriptions 有 `run_id` → diagnostic_runs，diagnostic_runs 又关联 client。我们用：

```
execution_items (initiative_id 非空, prescription_id 为空)
  → initiatives (goal_id)
    → 找最近一份 status IN ('approved','draft') 且属于同一 client_id 的 prescription
        优先用 generated_at 最接近 execution_items.created_at 的处方
        （处方是"批准时间锚"，execution_item 是"派活时间锚"，两者最近的就是因果链最大概率匹配）
```

**注意**：这是**启发式 backfill**，不是 FK 保证。老 87 卡片 backfill 完成后，新增 zhuge 行会走 application layer（action-persister 主动填）。

## 4. 待跑 SQL — Dry Run（先看数量，再跑真的）

### 4.1 步骤 1 — 看影响行数

```sql
-- DRY RUN：看 backfill 会影响多少行（不写任何东西）
WITH candidates AS (
  SELECT
    ei.id              AS execution_item_id,
    ei.client_id,
    ei.created_at      AS item_created_at,
    ei.initiative_id,
    ei.source
  FROM execution_items ei
  WHERE ei.prescription_id IS NULL
    AND ei.source IN ('zhuge', 'proactive_signal', 'luban', 'fde', 'fde_manual')
    -- 排除掉 source='diagnostic' 是为了不踩老路径，
    -- 排除掉 source='marketing_plan' 是因为它锚到 marketing_plan_id
)
SELECT
  source,
  COUNT(*)                                   AS rows_total,
  COUNT(*) FILTER (WHERE initiative_id IS NOT NULL) AS rows_with_initiative,
  COUNT(*) FILTER (WHERE initiative_id IS NULL)     AS rows_orphan
FROM candidates
GROUP BY source
ORDER BY rows_total DESC;
```

**期望输出**：CTS / Oztop 的 87 卡片大致按 source 分布。`rows_orphan`（无 initiative_id）的卡片暂时无法 backfill，留 NULL 即可（合法状态）。

### 4.2 步骤 2 — 看实际匹配率（仍然 dry run）

```sql
-- 看每一条候选行能不能找到对应处方
WITH candidates AS (
  SELECT
    ei.id              AS execution_item_id,
    ei.client_id,
    ei.created_at      AS item_created_at,
    ei.initiative_id,
    ei.source
  FROM execution_items ei
  WHERE ei.prescription_id IS NULL
    AND ei.source IN ('zhuge', 'proactive_signal', 'luban', 'fde', 'fde_manual')
    AND ei.initiative_id IS NOT NULL
),
nearest_prescription AS (
  SELECT
    c.execution_item_id,
    c.client_id,
    (
      SELECT p.id
      FROM prescriptions p
      WHERE p.client_id = c.client_id
        AND p.status IN ('approved', 'draft')
      ORDER BY ABS(EXTRACT(EPOCH FROM (p.generated_at - c.item_created_at))) ASC
      LIMIT 1
    ) AS prescription_id
  FROM candidates c
)
SELECT
  COUNT(*)                                          AS items_with_initiative,
  COUNT(*) FILTER (WHERE prescription_id IS NOT NULL) AS items_matched,
  COUNT(*) FILTER (WHERE prescription_id IS NULL)     AS items_unmatched
FROM nearest_prescription;
```

**期望输出**：`items_matched` 接近 `items_with_initiative`。若 `items_unmatched > 0`，说明对应 client 完全没有处方（不可能 backfill，留 NULL 即可）。

### 4.3 步骤 3 — 实际 UPDATE（**狄仁杰审过 + PM 拍板后才跑**）

```sql
-- 实际 backfill
-- 跑前请确认：
--   1. 步骤 1 的 rows_total 与你预期相符（CTS ~87 + Oztop ~n）
--   2. 步骤 2 的 items_matched / items_with_initiative > 80%
--   3. 备份 execution_items 表（或确认 Supabase 自动备份在过去 24h 内）

BEGIN;

WITH candidates AS (
  SELECT
    ei.id              AS execution_item_id,
    ei.client_id,
    ei.created_at      AS item_created_at,
    ei.initiative_id,
    ei.source
  FROM execution_items ei
  WHERE ei.prescription_id IS NULL
    AND ei.source IN ('zhuge', 'proactive_signal', 'luban', 'fde', 'fde_manual')
    AND ei.initiative_id IS NOT NULL
),
matched AS (
  SELECT
    c.execution_item_id,
    (
      SELECT p.id
      FROM prescriptions p
      WHERE p.client_id = c.client_id
        AND p.status IN ('approved', 'draft')
      ORDER BY ABS(EXTRACT(EPOCH FROM (p.generated_at - c.item_created_at))) ASC
      LIMIT 1
    ) AS prescription_id
  FROM candidates c
)
UPDATE execution_items ei
SET
  prescription_id = m.prescription_id,
  updated_at      = now()
FROM matched m
WHERE ei.id = m.execution_item_id
  AND m.prescription_id IS NOT NULL
  AND ei.prescription_id IS NULL;  -- safety guard: only fill NULL

-- 检查影响行数（应 = 步骤 2 的 items_matched）
SELECT COUNT(*) AS backfilled_rows
FROM execution_items
WHERE updated_at >= now() - interval '1 minute'
  AND prescription_id IS NOT NULL;

-- 若数量对，COMMIT；若不对，ROLLBACK
-- COMMIT;
-- ROLLBACK;
```

## 5. 完成后验收

```sql
-- 验收 1：CTS 卡片总数不变
SELECT COUNT(*) FROM execution_items WHERE client_id = (SELECT id FROM clients WHERE slug = 'cts-tours');
-- 期望：跟 backfill 前一致（87 或当前真实数）

-- 验收 2：CTS 卡片 prescription_id 命中率
SELECT
  COUNT(*)                                        AS total,
  COUNT(prescription_id)                          AS with_prescription,
  ROUND(100.0 * COUNT(prescription_id) / NULLIF(COUNT(*),0), 1) AS pct_with_prescription
FROM execution_items
WHERE client_id = (SELECT id FROM clients WHERE slug = 'cts-tours');

-- 验收 3：约束未破
SELECT conname, contype, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'execution_items'::regclass
  AND contype = 'c'
  AND conname = 'execution_items_source_consistency';
```

## 6. 回滚

```sql
-- 单条 client 回滚（保留其他客户的 backfill）
BEGIN;
UPDATE execution_items
SET prescription_id = NULL,
    updated_at      = now()
WHERE client_id = '<client_uuid>'
  AND source IN ('zhuge', 'proactive_signal', 'luban', 'fde', 'fde_manual')
  AND updated_at >= '<backfill_run_timestamp>';
-- 验证后 COMMIT 或 ROLLBACK
```

## 7. 强约束（不许跳）

1. **不许直接跑 4.3**，必须先跑 4.1 + 4.2 看数字
2. **狄仁杰审 SOP 后**才许跑（spec §2.4 + §5.3 6 底线）
3. **PM 拍板"go"** 才许跑
4. **跑完立刻验收**（第 5 节 3 个 SELECT）
5. **CTS 87 卡片不许丢任何一条**（验收 1）
6. **若 backfilled_rows ≠ items_matched，立即 ROLLBACK**，找子牙

## 8. 后续 application-layer 改动（PR 同步落地）

backfill 是**老数据修复**。新增 zhuge / luban / proactive_signal 行从此往后走 **application layer 主动填 prescription_id**：

- `src/lib/zhuge/action-persister.ts` — buildRow / writeExecutionItems 加 prescription_id 字段
- `src/lib/zhuge/assembler.ts` — 返回 latest_prescription_id
- `src/app/api/clients/[id]/zhuge/conduct/route.ts` — 传 prescription_id 到 persister

这部分在 PR `feat/dape-w5-execution-prescription-id` 一起 ship，不需要等 backfill。

---

**版本**：v1.0 · 2026-06-28 · 子牙起草
