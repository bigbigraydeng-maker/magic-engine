import type { DispatchJob } from './types'

/**
 * Jobs the dispatcher owns.
 *
 * Schedules are the ones Render was actually firing on 2026-10-24.
 * Suspended, paused, and deleted endpoints are absent on purpose:
 * oztop-seo-optimizer, lecture-publish, mailbox-sync-hourly,
 * the LinkedIn posters, and the jobs paused on 2026-10-07.
 */
export const DISPATCH_CATALOG: readonly DispatchJob[] = [
  { service: 'vision-analyzer', route: 'vision-analyzer', method: 'POST', auth: 'bearer', schedule: '50 * * * *', healthcheckUrl: 'https://hc-ping.com/1b1cd19b-583a-41ac-baaa-c9415241d5e8' },
  { service: 'poll-visual-jobs', route: 'poll-visual-jobs', method: 'GET', auth: 'bearer', schedule: '15 * * * *', healthcheckUrl: 'https://hc-ping.com/0dd2b641-499f-4f2f-8b73-73085050a5f0' },
  { service: 'site-audit-cron', route: 'site-audit-jobs', method: 'POST', auth: 'x-cron-secret', schedule: '0 2 * * *', healthcheckUrl: 'https://hc-ping.com/8451084d-23c0-44b0-af00-8e29ff80fcdc' },
  { service: 'attribution-cron', route: 'attribution', method: 'POST', auth: 'bearer', schedule: '0 */6 * * *', healthcheckUrl: 'https://hc-ping.com/87926446-35cf-4e5b-a868-bb784c27ee5f' },
  { service: 'zhangqian-sweeper', route: 'zhangqian-sweeper', method: 'GET', auth: 'bearer', schedule: '35 * * * *', healthcheckUrl: 'https://hc-ping.com/071910fe-b9b7-435d-8b72-f141818eb03d' },
  { service: 'prospecting-sweep', route: 'prospecting-sweep', method: 'GET', auth: 'bearer', schedule: '0 * * * *' },
  { service: 'blog-stuck-generating-sweeper', route: 'blog-stuck-generating', method: 'GET', auth: 'bearer', schedule: '45 * * * *', healthcheckUrl: 'https://hc-ping.com/180d3e65-1910-4f8d-a778-409571d5fb46' },
  { service: 'tailor-made-jobs-sweeper', route: 'tailor-made-jobs-sweeper', method: 'GET', auth: 'bearer', schedule: '*/30 * * * *' },
  { service: 'ai-tracker-weekly', route: 'ai-tracker-weekly', method: 'GET', auth: 'bearer', schedule: '0 18 * * 0', healthcheckUrl: 'https://hc-ping.com/c4f101fe-c2cf-47f9-807f-08ea09d43934' },
  { service: 'industry-ai-visibility-daily', route: 'ai-visibility-weekly', method: 'GET', auth: 'bearer', schedule: '30 16 * * 1', healthcheckUrl: 'https://hc-ping.com/1400fe83-cc62-4634-9f7e-a2345553beee', scheduleNote: 'Service name says daily. Production schedule is Monday 16:30 UTC. Kept.' },
  { service: 'goal-current-value-refresh', route: 'goal-current-value-refresh', method: 'GET', auth: 'bearer', schedule: '30 17 * * *', healthcheckUrl: 'https://hc-ping.com/300bb7f9-8a16-4a72-b9eb-a924dc76efa8' },
  { service: 'keyword-snapshots-weekly', route: 'keyword-snapshots-weekly', method: 'GET', auth: 'bearer', schedule: '0 2 * * 1', healthcheckUrl: 'https://hc-ping.com/db156874-3c69-4b5a-b534-a6bbea63a467' },
  { service: 'seo-weekly-list', route: 'seo-weekly-list', method: 'GET', auth: 'bearer', schedule: '30 4 * * 1' },
  { service: 'reputation-snapshots-weekly', route: 'reputation-snapshots-weekly', method: 'GET', auth: 'bearer', schedule: '30 3 * * 1' },
  { service: 'social-engagement-pullback', route: 'social-engagement-pullback', method: 'GET', auth: 'bearer', schedule: '0 4 * * *', healthcheckUrl: 'https://hc-ping.com/01c469cc-4e77-4e88-bba4-7f17cbec91bc' },
  { service: 'winner-reel-sync-daily', route: 'winner-reel-sync-daily', method: 'GET', auth: 'bearer', schedule: '0 15 * * *' },
  { service: 'google-data-pullback-daily', route: 'google-data-pullback-daily', method: 'GET', auth: 'bearer', schedule: '0 17 * * *', healthcheckUrl: 'https://hc-ping.com/12f3c5c4-4524-48b8-92c5-72fd2b775d01' },
  { service: 'zhuge-weekly-recalculate', route: 'zhuge-recalculate', method: 'GET', auth: 'bearer', schedule: '0 3 * * 1', healthcheckUrl: 'https://hc-ping.com/a2c4d128-e09c-41eb-843e-98c9a0afecba' },
  { service: 'viral-analyzer-worker', route: 'viral-analyzer-worker', method: 'POST', auth: 'bearer', schedule: '*/10 * * * *', healthcheckUrl: 'https://hc-ping.com/55891cbc-cfd5-4c58-b28b-f06206fade5a' },
  { service: 'viral-discovery-weekly', route: 'viral-discovery-weekly', method: 'POST', auth: 'bearer', schedule: '0 0 * * *', healthcheckUrl: 'https://hc-ping.com/e5c6cbe8-e6cc-457f-bb3f-538971dafd46', scheduleNote: 'Service name says weekly. Production schedule is daily at 00:00 UTC. Kept.' },
  { service: 'content-factory-intake', route: 'content-factory-intake', method: 'POST', auth: 'bearer', schedule: '0 22 * * *' },
  { service: 'diagnostic-weekly', route: 'diagnostic-weekly', method: 'GET', auth: 'bearer', schedule: '0 8 * * 1' },
  { service: 'kpi-backfill', route: 'kpi-backfill', method: 'GET', auth: 'bearer', schedule: '20 6 * * *' },
  { service: 'benchmark-accumulator', route: 'benchmark-accumulator', method: 'GET', auth: 'bearer', schedule: '40 7 * * 1' },
  { service: 'cms-connection-retest', route: 'cms-connection-retest', method: 'GET', auth: 'bearer', schedule: '10 6 * * *' },
  { service: 'prescription-weekly', route: 'prescription-weekly', method: 'GET', auth: 'bearer', schedule: '0 8 * * 2' },
  { service: 'anomaly-detector-daily', route: 'anomaly-detector', method: 'GET', auth: 'bearer', schedule: '0 5 * * *', healthcheckUrl: 'https://hc-ping.com/ff78126a-25e2-4a50-abcb-edbcb1dfaec9' },
  { service: 'daily-cron-digest', route: 'daily-cron-digest', method: 'GET', auth: 'bearer', schedule: '0 6 * * *', healthcheckUrl: 'https://hc-ping.com/10c101e8-05a0-4026-9531-39edddd7c74d' },
  { service: 'proposal-view-digest', route: 'proposal-view-digest', method: 'GET', auth: 'bearer', schedule: '0 19 * * *' },
  { service: 'agent-learning-rollup', route: 'agent-learning-rollup', method: 'POST', auth: 'bearer', schedule: '0 7 * * 1' },
  { service: 'memory-extractor', route: 'memory-extractor', method: 'POST', auth: 'bearer', schedule: '30 6 * * *' },
  { service: 'site-audit-weekly', route: 'site-audit-weekly', method: 'GET', auth: 'bearer', schedule: '0 1 * * 0' },
  { service: 'weekly-seo-report', route: 'weekly-seo-report', method: 'GET', auth: 'bearer', schedule: '30 18 * * 0' },
  { service: 'pm-daily-todo', route: 'pm-daily-todo', method: 'GET', auth: 'bearer', schedule: '0 19 * * 0-4' },
  { service: 'product-map-sync-daily', route: 'product-map-sync', method: 'GET', auth: 'bearer', schedule: '15 18 * * *' },
  { service: 'blog-weekly', route: 'blog-weekly', method: 'GET', auth: 'bearer', schedule: '0 3 * * 2' },
  { service: 'seo-patrol-daily', route: 'seo-patrol-daily', method: 'GET', auth: 'bearer', schedule: '0 4 * * *', healthcheckUrl: 'https://hc-ping.com/db58fff5-fd32-45e0-a7fd-b067bede6689' },
  { service: 'social-comment-autoreply', route: 'social-comment-autoreply', method: 'GET', auth: 'bearer', schedule: '0 * * * *' },
  { service: 'factory-publish-worker', route: 'factory-publish-worker', method: 'GET', auth: 'bearer', schedule: '5 * * * *' },
  { service: 'factory-order-scheduler', route: 'factory-order-scheduler', method: 'GET', auth: 'bearer', schedule: '0 20 * * *' },
  { service: 'factory-publish-sweeper', route: 'factory-publish-sweeper', method: 'GET', auth: 'bearer', schedule: '25 * * * *' },
  { service: 'messenger-hourly', route: 'messenger-sync-hourly', method: 'GET', auth: 'bearer', schedule: '10 * * * *' },
  { service: 'meta-leads-hourly', route: 'meta-leads-sync', method: 'GET', auth: 'bearer', schedule: '25 */2 * * *' },
  { service: 'ad-readback-sweep-daily', route: 'ad-readback-sweep', method: 'GET', auth: 'bearer', schedule: '40 20 * * *' },
  { service: 'ad-entity-snapshot', route: 'ad-entity-snapshot', method: 'GET', auth: 'bearer', schedule: '30 */6 * * *' },
  { service: 'mailchimp-activity-daily', route: 'mailchimp-activity-sync', method: 'GET', auth: 'bearer', schedule: '40 4 * * *' },
  { service: 'mailchimp-paid-tagging-daily', route: 'mailchimp-paid-tagging', method: 'GET', auth: 'bearer', schedule: '10 5 * * *' },
  { service: 'mailchimp-suppression-sync-daily', route: 'mailchimp-suppression-sync', method: 'GET', auth: 'bearer', schedule: '20 5 * * *' },
  { service: 'market-intel-daily', route: 'market-intel-daily', method: 'GET', auth: 'bearer', schedule: '0 18 * * *' },
  { service: 'cron-run-logs-cleanup', route: 'cron-run-logs-cleanup', method: 'GET', auth: 'bearer', schedule: '50 16 * * *' },
  { service: 'render-dashboard:baseline-domains-monthly', route: 'baseline-domains-monthly', method: 'GET', auth: 'bearer', schedule: '0 17 * * *', scheduleNote: 'Render service baseline-domains-weekly fires daily. The route throttles real collection to once every 7 days. Kept the daily knock.' },
]

export const DISPATCH_OWNED_SERVICES: ReadonlySet<string> = new Set(
  DISPATCH_CATALOG.map((job) => job.service),
)

