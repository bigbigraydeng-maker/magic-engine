/**
 * 全部定时任务清单（2026-08-03 自动从 render.yaml + 各接口代码生成）。
 *
 * 存在理由：render.yaml 只说「该跑」，不说「跑没跑」。这张表把两件事放一起，
 * 配合 schedule.ts 才能回答 PM 那个问题：**按时没完成，要有报错**。
 *
 * 🔴 `jobName` 取自接口代码里 `startCronRun('...')` 的那个字符串，
 *    **不是** render 服务名、也不是路由名。三者经常不一样
 *    （服务 messenger-hourly → 路由 messenger-sync-hourly → 日志名同路由）。
 *    首版按路由名猜，结果把 6 个一直在跑的任务判成「从来没跑过」——
 *    误报一旦成为常态，真出事那天也会被当成噪音划掉。
 *
 * 🔴 `logsRuns=false` 表示那个接口**代码里压根没调 startCronRun** ——
 *    不是它坏了，是我们看不见它。这类必须单独报，绝不能算成健康。
 *
 * 同目录的测试会重新解析 render.yaml 与接口代码跟这里对账，改了不同步就红。
 */

export interface CronRegistryEntry {
  /** render.yaml 里的服务名 */
  service: string
  /** 写进 cron_run_logs.job_name 的名字，取自代码里 startCronRun 的入参 */
  jobName: string
  schedule: string
  /** 这个接口有没有写运行记录 */
  logsRuns: boolean
  /**
   * 这条登记是什么时候加进来的（YYYY-MM-DD）。
   *
   * 🔴 只有一个用途：判断「从没跑过」是不是误报。新建的任务在第一次排班到点
   *    之前当然没有运行记录，那是正常的，不是故障。加新任务时填上当天日期；
   *    老任务不用补（它们早跑过很多轮，这层保护对它们没意义）。
   */
  addedAt?: string
}

export const CRON_REGISTRY: readonly CronRegistryEntry[] = [
  { service: 'agent-learning-rollup', jobName: 'agent-learning-rollup', schedule: '0 7 * * 1', logsRuns: true },
  { service: 'ai-tracker-weekly', jobName: 'ai-tracker-weekly', schedule: '0 1 * * 1', logsRuns: true },
  { service: 'anomaly-detector-daily', jobName: 'anomaly-detector-daily', schedule: '0 5 * * *', logsRuns: true },
  { service: 'attribution-cron', jobName: 'attribution-cron', schedule: '0 */6 * * *', logsRuns: true },
  { service: 'blog-stuck-generating-sweeper', jobName: 'blog-stuck-generating-sweeper', schedule: '*/30 * * * *', logsRuns: true },
  { service: 'blog-weekly', jobName: 'blog-weekly', schedule: '0 3 * * 2', logsRuns: true },
  { service: 'content-factory-intake', jobName: 'content-factory-intake', schedule: '0 22 * * *', logsRuns: true },
  { service: 'cts-seo-optimizer', jobName: 'cts-seo-optimizer', schedule: '30 5 * * 1', logsRuns: true },
  { service: 'daily-cron-digest', jobName: 'daily-cron-digest', schedule: '0 6 * * *', logsRuns: true },
  { service: 'diagnostic-weekly', jobName: 'diagnostic-weekly', schedule: '0 8 * * 1', logsRuns: true, addedAt: '2026-08-03' },
  // DAPE E 段：看板上的动作真正被跑掉的那一步。上线时挂着 ?dry_run=1 只选不做。
  { service: 'execution-auto-run', jobName: 'execution-auto-run', schedule: '30 9 * * *', logsRuns: true, addedAt: '2026-08-06' },
  { service: 'factory-order-scheduler', jobName: 'factory-order-scheduler', schedule: '0 20 * * *', logsRuns: true },
  { service: 'factory-publish-sweeper', jobName: 'factory-publish-sweeper', schedule: '*/15 * * * *', logsRuns: true },
  { service: 'factory-publish-worker', jobName: 'factory-publish-worker', schedule: '*/10 * * * *', logsRuns: true },
  { service: 'factory-stock-refill', jobName: 'factory-stock-refill', schedule: '0 19 * * 1', logsRuns: true },
  { service: 'goal-current-value-refresh', jobName: 'goal-current-value-refresh', schedule: '0 3 * * *', logsRuns: true },
  { service: 'google-data-pullback-daily', jobName: 'google-data-pullback-daily', schedule: '0 3 * * *', logsRuns: true },
  { service: 'industry-ai-visibility-daily', jobName: 'industry-ai-visibility-daily', schedule: '30 2 * * *', logsRuns: true },
  { service: 'job-boards-weekly', jobName: 'job-boards-weekly', schedule: '0 2 * * 1', logsRuns: true },
  // 效果回流两条 —— 2026-08-04 补接线：代码早就有，但从没进过 render.yaml，
  // 于是 prescription_outcomes 一条记录都没有（「方案有没有用」从没被回答过）。
  { service: 'kpi-backfill', jobName: 'kpi-backfill', schedule: '20 6 * * *', logsRuns: true, addedAt: '2026-08-04' },
  { service: 'benchmark-accumulator', jobName: 'benchmark-accumulator', schedule: '40 7 * * 1', logsRuns: true, addedAt: '2026-08-04' },
  { service: 'keyword-snapshots-weekly', jobName: 'keyword-snapshots-weekly', schedule: '0 2 * * 1', logsRuns: true },
  // mailbox-sync-hourly 已于 2026-08-03 从 render.yaml 移除：它作为独立服务一次都没跑过
  // （新增服务要有人进 Render 点一次 Apply，而这件事不报任何错），现在挂在 messenger-hourly
  // 里跑。留在清单里会天天误报「没跑」——正是这套告警最怕的东西。
  { service: 'mailchimp-activity-daily', jobName: 'mailchimp-activity-sync', schedule: '40 4 * * *', logsRuns: true },
  { service: 'messenger-hourly', jobName: 'messenger-sync-hourly', schedule: '10 * * * *', logsRuns: true },
  { service: 'meta-leads-hourly', jobName: 'meta-leads-sync', schedule: '25 * * * *', logsRuns: true },
  { service: 'oztop-seo-optimizer', jobName: 'oztop-seo-optimizer', schedule: '0 5 * * 1', logsRuns: true },
  { service: 'pm-daily-todo', jobName: 'pm-daily-todo', schedule: '0 19 * * 0-4', logsRuns: true },
  { service: 'poll-visual-jobs', jobName: 'poll-visual-jobs', schedule: '*/10 * * * *', logsRuns: true },
  { service: 'prescription-weekly', jobName: 'prescription-weekly', schedule: '0 8 * * 2', logsRuns: true, addedAt: '2026-08-04' },
  { service: 'cms-connection-retest', jobName: 'cms-connection-retest', schedule: '10 6 * * *', logsRuns: true, addedAt: '2026-08-05' },
  { service: 'proposal-view-digest', jobName: 'proposal-view-digest', schedule: '0 19 * * *', logsRuns: true },
  { service: 'prospecting-sweep', jobName: 'prospecting-sweep', schedule: '*/30 * * * *', logsRuns: true },
  { service: 'reputation-snapshots-weekly', jobName: 'reputation-snapshots-weekly', schedule: '30 3 * * 1', logsRuns: true },
  { service: 'seo-patrol-daily', jobName: 'seo-patrol-daily', schedule: '0 4 * * *', logsRuns: true },
  { service: 'site-audit-cron', jobName: 'site-audit-cron', schedule: '0 2 * * *', logsRuns: true },
  { service: 'site-audit-weekly', jobName: 'site-audit-weekly', schedule: '0 1 * * 0', logsRuns: true },
  { service: 'social-comment-autoreply', jobName: 'social-comment-autoreply', schedule: '*/30 * * * *', logsRuns: true },
  { service: 'social-engagement-pullback', jobName: 'social-engagement-pullback', schedule: '0 4 * * *', logsRuns: true },
  { service: 'team-memory-sweeper', jobName: 'team-memory-sweeper', schedule: '*/30 * * * *', logsRuns: true },
  { service: 'viral-analyzer-worker', jobName: 'viral-analyzer-worker', schedule: '*/10 * * * *', logsRuns: true },
  { service: 'viral-discovery-weekly', jobName: 'viral-discovery-weekly', schedule: '0 0 * * *', logsRuns: true },
  { service: 'vision-analyzer', jobName: 'vision-analyzer', schedule: '*/30 * * * *', logsRuns: true },
  { service: 'weekly-seo-report', jobName: 'weekly-seo-report', schedule: '30 18 * * 0', logsRuns: true },
  { service: 'winner-reel-sync-daily', jobName: 'winner-reel-sync-daily', schedule: '0 15 * * *', logsRuns: true },
  { service: 'zhangqian-sweeper', jobName: 'zhangqian-sweeper', schedule: '*/30 * * * *', logsRuns: true },
  { service: 'zhuge-weekly-recalculate', jobName: 'zhuge-weekly-recalculate', schedule: '0 3 * * 1', logsRuns: true },
] as const
