-- ============================================================================
-- content_work_orders.status 多允许一个值 'platform_draft'（2026-11-27）
-- 本文件只随 PR 提交。不要在这个 PR 里对生产库执行。
-- 上线顺序：先合并并部署读取兼容（PR1），再由 Ray 本人点头，才在生产库执行本文件。
--
-- ── 取值从哪来 ───────────────────────────────────────────────────────────
-- 仓库里唯一一次定义在
-- supabase/migrations/20260711000002_p21j_content_factory_m1.sql
-- （content_work_orders.status 上的未命名列 CHECK）。
-- 之后没有任何 migration 删除或重建 content_work_orders_status_check。
-- PostgreSQL 会把这个未命名列 CHECK 命名为 content_work_orders_status_check。
-- 当时的完整取值（16 个，一个不删）：
--   queued, claimed, producing, rendered, in_review, review_rejected,
--   approved, publishing, publish_failed, published, measuring, closed,
--   failed, dead_letter, archived, superseded
--
-- ── 改了什么 ─────────────────────────────────────────────────────────────
-- 1. DROP CONSTRAINT IF EXISTS content_work_orders_status_check。
-- 2. 用上面 16 个值 + 'platform_draft' 重建同名约束。
-- 不插入、不更新、不删除任何行。不改 RLS，不加列。
--
-- 下面两条 ALTER 必须在同一个事务里跑。ADD 失败时事务会把旧约束还原回来。
-- 不要在两条语句之间用自动提交。
-- ============================================================================

ALTER TABLE public.content_work_orders
  DROP CONSTRAINT IF EXISTS content_work_orders_status_check;

ALTER TABLE public.content_work_orders
  ADD CONSTRAINT content_work_orders_status_check
  CHECK (status IN (
    'queued',
    'claimed',
    'producing',
    'rendered',
    'in_review',
    'review_rejected',
    'approved',
    'publishing',
    'publish_failed',
    'published',
    'measuring',
    'closed',
    'failed',
    'dead_letter',
    'archived',
    'superseded',
    'platform_draft'
  ));

-- ============================================================================
-- 回滚（只有没有任何一行的 status = 'platform_draft' 时才能还原）
--
-- 先只读计数。结果不是 0 就停，不要为了还原去改这些行的状态：
--
--   SELECT count(*) FROM public.content_work_orders
--    WHERE status = 'platform_draft';
--
-- 计数为 0 时，仍在同一个事务里执行：
--
--   BEGIN;
--   ALTER TABLE public.content_work_orders
--     DROP CONSTRAINT IF EXISTS content_work_orders_status_check;
--   ALTER TABLE public.content_work_orders
--     ADD CONSTRAINT content_work_orders_status_check
--     CHECK (status IN (
--       'queued', 'claimed', 'producing', 'rendered', 'in_review',
--       'review_rejected', 'approved', 'publishing', 'publish_failed',
--       'published', 'measuring', 'closed', 'failed', 'dead_letter',
--       'archived', 'superseded'
--     ));
--   COMMIT;
--
-- 只要还有一行是 'platform_draft'，上面的 ADD 会失败，事务会留下新约束。
-- ============================================================================
