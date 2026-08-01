-- Layer 2 of the "让系统能说出我瞎了" defence: data freshness registry.
--
-- Why: checking that a cron *ran* is not enough — and 2026-08-01 proved something
-- worse. A Render cron whose CRON_SECRET is missing gets a 401, and because the
-- run-logging code sits *behind* the auth check, it leaves no row in
-- cron_run_logs at all. The job is not "failed"; it is invisible.
-- keyword-snapshots-weekly was invisible for 53 days that way; daily-cron-digest
-- for 51, then another 30.
--
-- Conclusion: "did the job run" is an unreliable signal by construction. The only
-- honest signal is the final product — did the table actually receive new rows?
-- That is what this registry watches.
--
-- Two tables:
--   1. data_freshness_expectations — the registry. One row per data stream, with
--      how often it is *expected* to receive a write. Adding coverage for a new
--      feature = INSERT one row. No code change required.
--   2. data_freshness_alerts — one row per stream per day (fresh AND stale), so
--      the history answers "when exactly did this break?" and so the table itself
--      has a heartbeat that the external (layer 3) check can watch.

-- ---------------------------------------------------------------------------
-- 1. Registry
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS data_freshness_expectations (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- physical table to probe
  table_name        text NOT NULL,
  -- column holding the write timestamp
  timestamp_column  text NOT NULL DEFAULT 'created_at',

  -- optional sub-stream scoping: lets one physical table be registered several
  -- times. Critical for two cases:
  --   * flywheel_metrics looks fresh at table level while an individual pillar
  --     prefix (social.) has been dead for two months;
  --   * cron_run_logs registered per job_name turns "this cron has never run"
  --     into a first-class alert — the direct detector for the missing-secret trap.
  filter_column     text,
  filter_prefix     text,

  -- column holding the owning client, when the stream is per-client. NULL means
  -- the stream is global (industry benchmarks, cron logs, self-heartbeat).
  -- Only used by the per-client dashboard view; the daily check is table-wide.
  client_column     text,

  -- human-readable, shows up verbatim in the PM's alert email
  label             text NOT NULL,
  -- which of the six pillars this feeds (seo / social / ads / reputation /
  -- ai_visibility / competitor), or 'ops' for infrastructure streams
  pillar            text NOT NULL DEFAULT 'ops',

  -- the expectation itself: alert when now() - max(timestamp_column) exceeds this
  max_age_hours     integer NOT NULL CHECK (max_age_hours > 0),

  -- Don't alert on an empty table before this date (feature not shipped yet).
  --
  -- Set it to the day AFTER the stream's first expected write, not the launch
  -- day itself: the daily check runs at 06:10 UTC, so a stream whose first write
  -- lands later that same day would be reported "never written" on its own
  -- launch morning. Nine of the seeded rows below are dated that way on purpose.
  monitor_from      date,

  enabled           boolean NOT NULL DEFAULT true,
  severity          text NOT NULL DEFAULT 'warn' CHECK (severity IN ('warn', 'critical')),
  notes             text,

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- Safe to re-run against a copy of this migration applied before client_column existed.
ALTER TABLE data_freshness_expectations
  ADD COLUMN IF NOT EXISTS client_column text;

-- one expectation per (table, sub-stream)
CREATE UNIQUE INDEX IF NOT EXISTS data_freshness_expectations_stream_uniq
  ON data_freshness_expectations (
    table_name,
    COALESCE(filter_column, ''),
    COALESCE(filter_prefix, '')
  );

ALTER TABLE data_freshness_expectations ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service_role_full" ON data_freshness_expectations FOR ALL USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- 2. Daily check results (fresh rows logged too — that's the heartbeat)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS data_freshness_alerts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  checked_on       date NOT NULL DEFAULT CURRENT_DATE,
  expectation_id   uuid REFERENCES data_freshness_expectations(id) ON DELETE CASCADE,

  -- denormalised so history survives a registry edit/delete
  stream_key       text NOT NULL,
  label            text NOT NULL,
  pillar           text NOT NULL,

  status           text NOT NULL CHECK (status IN ('fresh', 'stale', 'never')),
  last_written_at  timestamptz,
  age_hours        numeric,
  max_age_hours    integer NOT NULL,
  overdue_hours    numeric,
  row_count        bigint,
  severity         text NOT NULL DEFAULT 'warn',
  probe_error      text,

  created_at       timestamptz NOT NULL DEFAULT now()
);

-- idempotent: re-running the check on the same day overwrites, never duplicates
CREATE UNIQUE INDEX IF NOT EXISTS data_freshness_alerts_day_stream_uniq
  ON data_freshness_alerts (checked_on, stream_key);

CREATE INDEX IF NOT EXISTS data_freshness_alerts_status_idx
  ON data_freshness_alerts (status, checked_on DESC);

CREATE INDEX IF NOT EXISTS data_freshness_alerts_created_idx
  ON data_freshness_alerts (created_at DESC);

ALTER TABLE data_freshness_alerts ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service_role_full" ON data_freshness_alerts FOR ALL USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- 3. Seed the registry
--
-- Every max_age_hours below is calibrated against the stream's REAL write
-- history in this database (queried 2026-08-02 over the full life of each
-- table), not guessed. Where a stream's largest healthy gap is G days, the
-- threshold sits comfortably above G so a normal weekend / upstream lag never
-- fires, and anything genuinely stopped does.
--
-- Observed healthy gaps used for calibration:
--   gsc_performance_snapshots   max 4d over 54 write-days  -> 5d
--   ga4_traffic_snapshots       max 4d over 49 write-days  -> 5d
--   flywheel_metrics seo.*      max 4d over 46 write-days  -> 5d
--   flywheel_metrics ads.*      max 1d over 45 write-days  -> 5d
--   ad_daily_insights           max 1d over 12 write-days  -> 3d
--   ai_visibility_snapshots     Monday cadence, 7d         -> 10d
--   flywheel_metrics geo.*      Monday cadence, 7d         -> 10d
-- ---------------------------------------------------------------------------
INSERT INTO data_freshness_expectations
  (table_name, timestamp_column, filter_column, filter_prefix, client_column,
   label, pillar, max_age_hours, monitor_from, severity, notes)
VALUES
  -- --- 六支柱产物 ------------------------------------------------------------
  ('gsc_performance_snapshots', 'created_at', NULL, NULL, 'client_id',
   'Google 搜索表现（每日）', 'seo', 120, '2026-05-27', 'critical',
   '每日 cron。真实历史最大健康间隔 4 天（周末 + GSC 自身延迟），阈值取 5 天。'),

  ('ga4_traffic_snapshots', 'created_at', NULL, NULL, 'client_id',
   '网站访问数据 GA4（每日）', 'seo', 120, '2026-05-30', 'critical',
   '每日 cron。与 GSC 同一节奏，同样跳周末，真实最大间隔 4 天。'),

  ('ad_daily_insights', 'created_at', NULL, NULL, 'client_id',
   '广告每日花费与效果（每日）', 'ads', 72, '2026-07-21', 'critical',
   '每日 cron，历史无缺口（最大间隔 1 天），阈值 3 天。'),

  ('keyword_snapshots', 'created_at', NULL, NULL, 'client_id',
   '关键词排名（每周）', 'seo', 240, '2026-06-04', 'critical',
   '每周 cron。阈值 10 天 = 一周 + 3 天缓冲。2026-06-04 → 2026-07-28 空了 53 天，'
   '根因是 Render 上这个任务的 CRON_SECRET 没填，接口 401 且不留日志 —— 本表就是为了'
   '让这种「静默失踪」在第二天而不是第 53 天被看见。'),

  ('ai_visibility_snapshots', 'created_at', NULL, NULL, 'client_id',
   'AI 可见度快照（每周）', 'ai_visibility', 240, '2026-06-15', 'critical',
   '每周一写入（ai-tracker-weekly），历史规律。阈值 10 天。'),

  ('competitor_snapshots', 'created_at', NULL, NULL, 'client_id',
   '竞品快照（每周）', 'competitor', 240, '2026-06-12', 'warn',
   '每周 cron。阈值 10 天。'),

  ('reputation_snapshots', 'created_at', NULL, NULL, 'client_id',
   '口碑评分快照（每周）', 'reputation', 240, '2026-08-02', 'warn',
   '2026-08-01 才上线（reputation-snapshots-weekly）。monitor_from 设为上线日，'
   '避免对上线前的空表报警。'),

  -- --- 飞轮指标：必须按支柱前缀分流 ------------------------------------------
  ('flywheel_metrics', 'created_at', 'metric_key', 'seo.', 'client_id',
   '飞轮指标 · SEO', 'seo', 120, '2026-06-02', 'warn',
   '按 metric_key 前缀分流监控 —— 表级检查会被其他支柱的写入掩盖。'),

  ('flywheel_metrics', 'created_at', 'metric_key', 'ads.', 'client_id',
   '飞轮指标 · 广告', 'ads', 120, '2026-06-18', 'warn', NULL),

  ('flywheel_metrics', 'created_at', 'metric_key', 'geo.', 'client_id',
   '飞轮指标 · AI 可见度', 'ai_visibility', 240, '2026-06-15', 'warn',
   '跟 ai-tracker-weekly 同步，每周一写入 —— 是周更不是日更，阈值 10 天。'),

  ('flywheel_metrics', 'created_at', 'metric_key', 'social.', 'client_id',
   '飞轮指标 · 社媒', 'social', 240, '2026-06-01', 'critical',
   '教科书级案例：social-engagement-pullback 连续 30 天 status=completed，'
   '而这条流 2026-05-31 到 2026-08-01 之间一行都没写。表级 max(created_at) 天天显示'
   '「今天」，只有按前缀分流才看得见。'),

  -- --- 异常检测的最终产物 ----------------------------------------------------
  ('anomaly_signals', 'created_at', NULL, NULL, 'client_id',
   '异常信号（每日）', 'ops', 168, '2026-08-01', 'critical',
   'anomaly detector 的最终产物。连续 7 天全客户零异常本身就可疑。'),

  ('industry_benchmarks', 'created_at', NULL, NULL, NULL,
   '行业基准（每月）', 'ops', 1080, '2026-05-14', 'warn',
   '阈值 45 天 = 一个月 + 半个月缓冲。注意：这条目前是 PM 主动暂停的（每月约 US$360），'
   '不是故障。要恢复就把 BASELINE_CRON_ENABLED 设成 true；要停掉这条告警就把本行 enabled 设为 false。'),

  -- --- 直接盯 cron 有没有跑：missing-secret 陷阱的正面探测器 ------------------
  -- 密钥没配 -> 401 -> 鉴权之后的写日志代码根本没执行 -> cron_run_logs 里连失败都没有。
  -- 所以「这个 job 的日志停了 / 从来没有过」本身就是密钥没配的直接信号。
  ('cron_run_logs', 'started_at', 'job_name', 'keyword-snapshots-weekly', NULL,
   '任务心跳 · 关键词排名周更', 'ops', 240, '2026-07-29', 'critical',
   '2026-07-28 之前这里一条记录都没有，整整 53 天。'),

  ('cron_run_logs', 'started_at', 'job_name', 'daily-cron-digest', NULL,
   '任务心跳 · 每日任务汇总', 'ops', 48, '2026-07-28', 'critical',
   '哑过两次（51 天 + 30 天），两次都是同一个根因：CRON_SECRET 没填。'),

  ('cron_run_logs', 'started_at', 'job_name', 'anomaly-detector-daily', NULL,
   '任务心跳 · 每日异常检测', 'ops', 48, '2026-07-03', 'warn', NULL),

  ('cron_run_logs', 'started_at', 'job_name', 'data-freshness-check', NULL,
   '任务心跳 · 本检查自己', 'ops', 48, NULL, 'critical',
   '自监控第一层：本检查自己的 CRON_SECRET 要是也没配，这一行会在第二天变红 —— '
   '但那时本检查已经不跑了，所以真正兜底的是第三层（GitHub Actions）。'),

  -- --- 自身心跳：第三层盯的就是这一张 ----------------------------------------
  ('data_freshness_alerts', 'created_at', NULL, NULL, NULL,
   '新鲜度自检自身心跳', 'ops', 48, NULL, 'critical',
   '自监控：这张表停止写入 = 每日新鲜度检查本身死了。GitHub Actions 上的外部检查'
   '盯的就是这一张 —— 它不经过 ME 的任何服务。')
ON CONFLICT DO NOTHING;
