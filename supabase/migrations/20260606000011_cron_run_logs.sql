-- Cron health monitoring: unified run log for all cron jobs
-- Each cron writes a row on start (status=running) and updates on finish.
-- 保留策略不在这个文件里，见文件末尾那段说明（2026-09-07 搬到每日清理任务）。

CREATE TABLE IF NOT EXISTS public.cron_run_logs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_name        TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'running'
                    CHECK (status IN ('running', 'completed', 'failed')),
  started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at     TIMESTAMPTZ,
  duration_ms     INTEGER,
  processed       INTEGER DEFAULT 0,
  completed_count INTEGER DEFAULT 0,
  failed_count    INTEGER DEFAULT 0,
  summary         JSONB,
  error_message   TEXT
);

CREATE INDEX IF NOT EXISTS cron_run_logs_job_name_idx
  ON public.cron_run_logs(job_name, started_at DESC);

CREATE INDEX IF NOT EXISTS cron_run_logs_started_at_idx
  ON public.cron_run_logs(started_at DESC);

ALTER TABLE public.cron_run_logs ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service_role_full" ON public.cron_run_logs
    FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 保留策略已搬走（2026-09-07）────────────────────────────────────────────────
-- 这里原本建了一个 AFTER INSERT 触发器，每插一行就 `DELETE ... < NOW() - 30 days`。
--
-- 🔴 这一段被**故意删掉**，不是忘了。两个理由，都是实测的：
--
-- ① 这个文件从来没进过账本（2026-09-07 实测 supabase_migrations.schema_migrations
--    里查不到 20260606000011），也就是说任何一次同步都会把它当成没跑过重新执行。
--    而生产上的函数体早被人手工换成了两条更保守的规则（7 天空记录 + 180 天硬上限）。
--    留着这段 CREATE OR REPLACE，重跑一次就会把生产换回「30 天全删」，
--    一次删掉 16257 行运行历史 —— 那是所有定时任务健康检查唯一的数据源。
--
-- ② 每天 400~600 次插入 = 每天 400~600 次全表 DELETE，并发插入还会死锁，
--    而死锁让**插入本身失败**，等于让监控自己瞎掉。
--
-- 保留策略现在归 supabase/migrations/20260907000001_cron_run_logs_retention_daily_job.sql
-- （规则一行没改，逐字搬的生产函数体），每天由 /api/cron/cron-run-logs-cleanup 调一次。
