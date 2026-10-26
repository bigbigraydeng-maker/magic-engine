/**
 * 一条定时任务正常最多跑多久（秒），取自该路由的 `export const maxDuration`。
 *
 * 清理任务用它的两倍判断「还停在 running」是不是进程重启留下的孤儿行。
 * 表里没有的任务（Inngest、或 `startCronRun` 用了常量而不是字面量）走 2 小时默认。
 *
 * 只收录 `startCronRun('字面量')` 和 `maxDuration` 写在同一个路由文件里的任务。
 * 对账测试会重新扫这些文件，改了时长这里没跟着改就会红。
 */
export const JOB_MAX_DURATION_SEC: Readonly<Record<string, number>> = {
  'ad-entity-snapshot': 600,
  'ad-readback-sweep': 600,
  'agent-learning-rollup': 300,
  'ai-tracker-weekly': 900,
  'industry-ai-visibility-daily': 600,
  'anomaly-detector-daily': 300,
  'attribution-cron': 300,
  'baseline-domains-monthly': 600,
  'benchmark-accumulator': 300,
  'blog-weekly': 900,
  'cms-connection-retest': 300,
  'content-factory-intake': 300,
  'cron-run-logs-cleanup': 120,
  'diagnostic-weekly': 800,
  'execution-auto-run': 900,
  'factory-order-scheduler': 120,
  'factory-publish-sweeper': 60,
  'factory-publish-worker': 300,
  'factory-stock-refill': 300,
  'goal-current-value-refresh': 300,
  'goals-expiry-check': 60,
  'google-data-pullback-daily': 900,
  'job-boards-weekly': 300,
  'keyword-snapshots-weekly': 900,
  'kpi-backfill': 300,
  'mailbox-sync': 600,
  'mailchimp-activity-sync': 600,
  'mailchimp-paid-tagging': 600,
  'mailchimp-suppression-sync': 300,
  'memory-extractor': 300,
  'messenger-sync-hourly': 600,
  'meta-leads-sync': 600,
  'oztop-seo-optimizer': 300,
  'prescription-weekly': 120,
  'product-map-sync': 300,
  'prospecting-sweep': 300,
  'reputation-snapshots-weekly': 900,
  'seo-patrol-daily': 300,
  'seo-weekly-list': 300,
  'site-audit-cron': 120,
  'social-comment-autoreply': 900,
  'social-engagement-pullback': 300,
  'team-memory-sweeper': 300,
  'viral-analyzer-worker': 300,
  'viral-discovery-weekly': 300,
  'vision-analyzer': 120,
  'winner-reel-sync-daily': 300,
  'zhuge-weekly-recalculate': 900,
}

/** 不知道预计时长时，超过这么久还在 running 就当孤儿行。 */
export const UNKNOWN_ABANDON_AFTER_MS = 2 * 60 * 60 * 1000

/** 已知预计时长 → 两倍；未知 → 2 小时。 */
export function abandonAfterMs(jobName: string): number {
  const sec = JOB_MAX_DURATION_SEC[jobName]
  if (sec == null || !Number.isFinite(sec) || sec <= 0) return UNKNOWN_ABANDON_AFTER_MS
  return sec * 1000 * 2
}
