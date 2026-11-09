-- =============================================================================
-- cron_run_logs 保留策略：从「每插一行就全表扫删」的触发器，改成每天一次的独立任务
--
-- ── 生产实测（2026-09-07，glbdnayojixmexgofbsd）───────────────────────────────
-- 起因是有人看到「最老的一行是 62 天前，而 20260606000011 写的是 30 天 TTL」，
-- 判断这个清理在生产上没生效。**实测推翻了这个判断**：
--   · 触发器 cron_run_logs_ttl 存在，tgenabled = 'O'（启用）
--   · 函数 public.cron_run_logs_cleanup() 存在
--   · pg_stat_user_tables.n_tup_del = 4573（历史上真删过）
--   · 按生产函数自己的规则「本该删掉但还留着」的行数 = 1（≈0，证明每次插入都在跑）
--
-- 真正的问题是**仓库和生产不一致**：生产上的函数体早被人手工改过，不再是
-- 20260606000011 里那句「删 30 天以上的全部」，而是两段更保守的规则：
--   ① 7 天以上、status='completed' 且什么都没留下（summary / error / 三个计数全空）
--      的**噪音行**才删，且每个 job_name 至少保留最新一条
--   ② 180 天以上的全部删（硬上限）
-- 62 天前那批行有 summary、也没到 180 天，所以留着是**规则本来就要留**。
--
-- 而 20260606000011 **没有登记进 supabase_migrations.schema_migrations**
-- （实测 ledger_rows = 0）。也就是说任何一次 db push 都会把它当成没跑过重新执行，
-- CREATE OR REPLACE 会把生产上这条好规则**换回「30 天全删」**，
-- 一次删掉 16257 行运行历史。本文件在旧文件之后执行，负责把它拆掉。
--
-- ── 为什么不留触发器 ────────────────────────────────────────────────────────
-- 每天 400~600 次插入 = 每天 400~600 次全表 DELETE（其中一段还带 job_name 相关子查询）。
-- 并发插入时两个事务同时删同一批旧行会死锁，而死锁会让**插入整个失败** ——
-- 运行记录写失败恰好是这套监控最不能出的事（见 PR #1434：写失败会被静默吞掉）。
-- 清理频率跟插入频率本来就没有关系，改成每天一次的 /api/cron/cron-run-logs-cleanup。
--
-- ── 保留规则一行不改 ────────────────────────────────────────────────────────
-- 下面这个函数是生产上那个函数体的逐字搬运，只是从触发器函数改成可调用的 RPC，
-- 并把删除条数报出来。**这次上线不会多删任何一行。**
-- =============================================================================

-- 1. 拆掉每次插入都跑的触发器 ------------------------------------------------
DROP TRIGGER IF EXISTS cron_run_logs_ttl ON public.cron_run_logs;
DROP FUNCTION IF EXISTS public.cron_run_logs_cleanup();

-- 2. 同一套保留规则，改成每天由 cron 调一次的函数 ------------------------------
CREATE OR REPLACE FUNCTION public.cron_run_logs_purge()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_noise   bigint := 0;
  v_expired bigint := 0;
BEGIN
  -- ① 噪音行：跑完了、什么信息都没留下的空记录。
  --    最后那条 MAX 子查询保证**每个 job_name 至少留最新一条** ——
  --    全删光的话，健康检查会把「一直在跑但从来没内容」错判成「从没跑过」。
  WITH deleted AS (
    DELETE FROM public.cron_run_logs c
    WHERE c.started_at < NOW() - INTERVAL '7 days'
      AND c.status = 'completed'
      AND c.summary IS NULL
      AND c.error_message IS NULL
      AND COALESCE(c.processed, 0) = 0
      AND COALESCE(c.completed_count, 0) = 0
      AND COALESCE(c.failed_count, 0) = 0
      AND c.started_at < (
        SELECT MAX(c2.started_at) FROM public.cron_run_logs c2 WHERE c2.job_name = c.job_name
      )
    RETURNING 1
  )
  SELECT count(*) INTO v_noise FROM deleted;

  -- ② 硬上限：180 天以上一律删，不管里面有什么。
  WITH deleted AS (
    DELETE FROM public.cron_run_logs
    WHERE started_at < NOW() - INTERVAL '180 days'
    RETURNING 1
  )
  SELECT count(*) INTO v_expired FROM deleted;

  RETURN jsonb_build_object(
    'purged_noise',      v_noise,
    'purged_expired',    v_expired,
    'remaining',         (SELECT count(*) FROM public.cron_run_logs),
    'oldest_started_at', (SELECT min(started_at) FROM public.cron_run_logs)
  );
END;
$$;

-- 3. 只有后台服务能调 ---------------------------------------------------------
-- 🔴 只写 FROM PUBLIC 收不干净：Supabase 建库时配了默认权限，新函数会自动带上
--    anon=X / authenticated=X 两条**独立**授权，不经过 PUBLIC（见 20260903000001）。
REVOKE EXECUTE ON FUNCTION public.cron_run_logs_purge() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cron_run_logs_purge() TO service_role;

-- 4. 顺手把这张表的访问策略写成铁律要求的形式 ----------------------------------
-- 生产上现在已经是对的（实测 roles=service_role），但 20260606000011 里写的是
-- `FOR ALL USING (true)` —— **漏了 TO service_role 就等于对匿名访客敞开读写**。
-- 那个文件没进账本，随时可能在一个空库上重跑；这里显式重建成正确形式，
-- 让仓库里的最终状态跟生产一致，也让任何新环境从一开始就是锁好的。
DROP POLICY IF EXISTS "service_role_full" ON public.cron_run_logs;
CREATE POLICY "service_role_full" ON public.cron_run_logs
  FOR ALL TO service_role USING (true) WITH CHECK (true);
