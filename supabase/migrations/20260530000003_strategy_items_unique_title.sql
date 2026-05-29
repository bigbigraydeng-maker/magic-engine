-- P14.C.3: Add unique constraint on (client_id, proposed_title) for
-- content_strategy_items so that "重新生成策略" cannot pollute the kanban
-- with duplicate proposed titles each run.
--
-- Step 1: Collapse existing duplicates to the most-recent row.
--   Strategy: keep the row with the largest created_at per (client_id, proposed_title).
--   Tiebreak by id to make the choice deterministic.
--
-- Step 2: Add the unique constraint.
--
-- Application code (POST /api/clients/[id]/strategy/generate) will be
-- updated in the same Phase 14.C.3 commit to upsert with onConflict:
--   ignoreDuplicates: true
-- so existing proposed titles are skipped, not surfaced as errors.

-- ── Step 1: Deduplicate existing rows ────────────────────────────────────────

WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY client_id, proposed_title
      ORDER BY created_at DESC, id DESC
    ) AS rn
  FROM content_strategy_items
)
DELETE FROM content_strategy_items
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- ── Step 2: Add the unique constraint ────────────────────────────────────────

ALTER TABLE content_strategy_items
  ADD CONSTRAINT content_strategy_items_client_title_unique
  UNIQUE (client_id, proposed_title);

-- ── Verification queries (run manually to confirm) ───────────────────────────
-- SELECT COUNT(*) FROM content_strategy_items;
-- SELECT client_id, proposed_title, COUNT(*)
--   FROM content_strategy_items
--   GROUP BY 1, 2
--   HAVING COUNT(*) > 1;  -- should return 0 rows
