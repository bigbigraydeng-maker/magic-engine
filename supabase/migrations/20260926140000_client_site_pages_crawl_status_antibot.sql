-- ============================================================================
-- client_site_pages 抓取状态允许「被网站防火墙挡住」（2026-09-26）
-- ⚠️ 本文件只随 PR 提交，不在 PR 内 apply，apply 需 PM 显式 go。
--
-- ── 为什么 ───────────────────────────────────────────────────────────────
-- src/lib/site-audit/job-executor.ts 自 2026-06-20 起，会把抓取时被网站防火墙
-- 挡下（拿到的是挑战页而不是真实内容）的页面标成 crawl_status='antibot_challenged'，
-- 好让下游「内容太薄」的判断跳过这些页。
-- 但生产约束 client_site_pages_crawl_status_check 只允许 'pending','crawled','failed'，
-- 所以这类写入一直被数据库拒绝，而代码没有检查这个错误。结果 2026-09-26 发现：
-- 一行都没标上，某客户 117 行挑战页被当成正常抓取页存了下来，每日待办把它们
-- 报成「内容太薄」。
--
-- ── 改了什么 ─────────────────────────────────────────────────────────────
-- 1. 回填（幂等，在生产是 no-op）三个仓库历史从未记录过的列：path、crawl_status、
--    crawl_error —— 定义照抄 2026-09-26 的生产库。
-- 2. client_site_pages_crawl_status_check 多允许一个值 'antibot_challenged'。
--    已有取值不变。不改任何数据。不动 RLS。
-- 3. 部署顺序写死：先 apply 本文件，再合并/部署依赖它的代码（否则被挡页的标记
--    仍写不进去；同 PR 的代码会把「没能标记上」的原因写进那次任务的 error_message）。
-- 4. 2026-09-26 生产只读核过：本表「不允许为空且没有默认值」的列只有
--    client_id、url、path，被挡分支三列都写；page_type / topics / has_geo_block
--    有默认值（'other' / '{}' / false），放开约束后被挡标记不会再被拒。
-- ============================================================================

-- 这三列在生产库里存在，但从未进过仓库的 migration，所以本块在生产是 no-op，
-- 只是让从零重放（scripts/db-replay-and-verify.sh）的结果与生产一致。
ALTER TABLE public.client_site_pages
  ADD COLUMN IF NOT EXISTS path         text NOT NULL,
  ADD COLUMN IF NOT EXISTS crawl_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS crawl_error  text;

ALTER TABLE public.client_site_pages
  DROP CONSTRAINT IF EXISTS client_site_pages_crawl_status_check;
ALTER TABLE public.client_site_pages
  ADD CONSTRAINT client_site_pages_crawl_status_check
  CHECK (crawl_status IN ('pending', 'crawled', 'failed', 'antibot_challenged'));

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- apply 之后人工自验
-- 1. SELECT pg_get_constraintdef(oid) FROM pg_constraint
--      WHERE conname = 'client_site_pages_crawl_status_check';
--    → 输出含 'antibot_challenged'。
-- 2. apply 之后第一次每周重爬结束（任务 status='completed'）时，两条都要看：
--      SELECT client_id, completed_at, error_message
--        FROM site_audit_jobs
--       WHERE completed_at > '<APPLY_TIME>'
--       ORDER BY completed_at DESC;
--    → error_message 为空 = 被挡页都标上了；不为空 = 标记又失败了，里面写着第一个原因。
--      SELECT client_id, crawl_status, count(*)
--        FROM client_site_pages
--       WHERE crawled_at > '<APPLY_TIME>'
--       GROUP BY 1, 2;
--    → 已知会被挡的客户，这次重爬碰到的页里应出现 antibot_challenged（> 0）。
-- 3. 回滚：把约束改回三值之前，先
--      UPDATE client_site_pages SET crawl_status='crawled'
--        WHERE crawl_status='antibot_challenged';
--    （改生产数据，需 PM 点头），再按原三值重建约束。
-- ============================================================================
