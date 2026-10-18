-- ============================================================================
-- Monthly recurring goals — auto rollover on natural month boundary
-- ============================================================================
-- 背景：goals-expiry-check cron 只把过期目标标 expired，不会创建下一周期。
-- NAL 从 2026-09-24 起是 PM 授权的广告全权自治，广告策略引擎每天读它的月目标
-- 决定投放；一旦目标过期没接续，自治引擎就失去目标口径。这条迁移加一个显式
-- 的 recurrence 标记，让 cron 知道哪些目标需要每月自动续，绝不凭「上个月有个
-- 目标」就无脑续（一次性活动目标不该被无限续）。
--
-- 改动：
--   1. goals.recurrence text，可空，值仅限 'monthly'（预留未来 weekly/quarterly）
--   2. 部分唯一索引：同一 (client_id, primary_metric_key, period_start) 里
--      只能有一条 recurrence='monthly' 的目标（幂等保障，cron 跑两次不会重复造）
--
-- 兼容性：
--   - 所有现有 goals.recurrence 默认 NULL —— 现有目标行为不变
--   - 部分索引不影响 recurrence IS NULL 的目标
-- ============================================================================

alter table goals
  add column if not exists recurrence text
    check (recurrence is null or recurrence in ('monthly'));

comment on column goals.recurrence is
  'Auto-rollover cadence. NULL = one-shot goal (default). ''monthly'' = cron creates next natural month goal on the day after period_end. Reserved values for future: weekly, quarterly.';

create unique index if not exists uniq_goals_monthly_per_client_metric_month
  on goals(client_id, primary_metric_key, period_start)
  where recurrence = 'monthly';
