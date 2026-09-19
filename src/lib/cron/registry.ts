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

/**
 * 谁在定时敲这个接口。
 *
 * 🔴 加这个字段是因为「不在 render.yaml 里」曾经被当成「没人调度」——
 *    2026-09-07 实测推翻了这个假设：`baseline-domains-monthly` 每周都在跑，
 *    调度它的是**有人在 Render 后台手工建的**一条 cron（这一点它自己的路由注释
 *    里就写着，见该文件的成本闸门那段），`goals-expiry-check` 则由 GitHub Actions
 *    调度。清单原来只认 render.yaml，于是这两个一直在跑的任务被排除在监控之外。
 *
 * · `render`         —— render.yaml 里的 cron 服务（绝大多数）
 * · `github-actions` —— .github/workflows/*.yml 里的定时工作流
 * · `external`       —— 仓库外：Render 后台手工建的 cron。**改不了、也 review 不到**，
 *                       所以更需要被监控：它哪天被人删了，这里是唯一会喊的地方。
 * · `inngest`        —— Inngest 云端函数自带的 cron 触发器（见 src/lib/inngest/functions/）。
 *                       ⚠️ Render 不是 Vercel、没有自动同步：新增函数或改了触发器之后，
 *                       必须有人去 Inngest 后台对 `/api/inngest` 重新 Sync 一次，
 *                       否则它**安静地不跑**。这类登记的全部意义就是把「安静地不跑」喊出来。
 */
export type CronScheduler = 'render' | 'github-actions' | 'external' | 'inngest'

export interface CronRegistryEntry {
  /** 调度它的那个东西的名字：render.yaml 服务名 / 工作流文件名 / 仓库外的标识 */
  service: string
  /** 写进 cron_run_logs.job_name 的名字，取自代码里 startCronRun 的入参 */
  jobName: string
  schedule: string
  /** 这个接口有没有写运行记录 */
  logsRuns: boolean
  /** 谁在调度它。不填 = `render`（54 条老登记全是 render，不逐条补） */
  scheduler?: CronScheduler
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
  // 补登记：这条 cron 2026-08-05 就进了 render.yaml（commit 3c6fe88c），清单里一直没有 ——
  // 也就是说它从上线起就不在监控范围内，而「不在监控范围」和「一切正常」在告警里长得一模一样。
  // 是本 PR 新加的这份对账测试把它抓出来的（service 名带 -daily，jobName 不带）。
  //
  // 🔴 **故意不填 `addedAt`。** 它是 2026-08-05 的老任务，不是今天新建的；填今天的日期会给它
  //    约 62 小时宽限期，而这段时间正好会把「它从上线到现在一次都没跑过」盖住 ——
  //    补登记的全部意义就是把这件事查出来，宽限期会直接抵消掉它。
  //    按本字段自己的约定：老任务不补 addedAt。（Codex thread：registry.ts L41）
  { service: 'ad-readback-sweep-daily', jobName: 'ad-readback-sweep', schedule: '40 20 * * *', logsRuns: true },
  // ads IMPACT 阶段 1：广告设置快照，只在设置变化时记一行、另每天一次（只读 Meta）。
  { service: 'ad-entity-snapshot', jobName: 'ad-entity-snapshot', schedule: '30 */3 * * *', logsRuns: true, addedAt: '2026-09-14' },
  { service: 'agent-learning-rollup', jobName: 'agent-learning-rollup', schedule: '0 7 * * 1', logsRuns: true },
  // IMPACT 的 Tune 段。路由早就写好了，但从 Phase 23.C 起**一直没登记调度** ——
  // cron_run_logs 里零条运行记录，而 Check 段 2026-08~09 产出了 285 条结论。
  // 「没通电」和「一切正常」在监控里长得一模一样，正是这张表要解决的那个病。
  { service: 'memory-extractor', jobName: 'memory-extractor', schedule: '30 6 * * *', logsRuns: true, addedAt: '2026-09-06' },
  { service: 'ai-tracker-weekly', jobName: 'ai-tracker-weekly', schedule: '0 1 * * 1', logsRuns: true },
  { service: 'anomaly-detector-daily', jobName: 'anomaly-detector-daily', schedule: '0 5 * * *', logsRuns: true },
  { service: 'attribution-cron', jobName: 'attribution-cron', schedule: '0 */6 * * *', logsRuns: true },
  { service: 'blog-stuck-generating-sweeper', jobName: 'blog-stuck-generating-sweeper', schedule: '45 * * * *', logsRuns: true },
  { service: 'blog-weekly', jobName: 'blog-weekly', schedule: '0 3 * * 2', logsRuns: true },
  { service: 'content-factory-intake', jobName: 'content-factory-intake', schedule: '0 22 * * *', logsRuns: true },
  // 运行记录自己的清理任务。以前是 cron_run_logs 表上的 AFTER INSERT 触发器，
  // 每天 400~600 次插入就跑 400~600 次全表 DELETE，并发时会死锁 —— 而死锁让插入失败，
  // 也就是让这套监控自己瞎掉。2026-09-07 改成每天一次的独立任务。
  { service: 'cron-run-logs-cleanup', jobName: 'cron-run-logs-cleanup', schedule: '50 16 * * *', logsRuns: true, addedAt: '2026-09-07' },
  { service: 'cts-seo-optimizer', jobName: 'cts-seo-optimizer', schedule: '30 5 * * 1', logsRuns: true },
  { service: 'daily-cron-digest', jobName: 'daily-cron-digest', schedule: '0 6 * * *', logsRuns: true },
  { service: 'diagnostic-weekly', jobName: 'diagnostic-weekly', schedule: '0 8 * * 1', logsRuns: true, addedAt: '2026-08-03' },
  // 客人来信没人回 → 每天早上给销售发一封汇总信。UTC 20:00 = 次日 NZ 08:00（NZST=UTC+12）。
  // email-reply-digest 于 2026-09-03 暂停（PM 拍板，上线当天，一封都没发出去过）：
  // 名单里噪音占七成 —— 现有排除只挡「自己人域名」和「同行域名」，挡不住陌生公司
  // 群发的推销，而排序按「等最久」，等最久的恰好是没人理的营销邮件。
  // render.yaml 里那段已注释掉，这里同步摘掉登记：留着会天天误报「没跑」，
  // 正是这套告警最怕的东西（跟 mailbox-sync-hourly 同一个理由）。
  // 恢复时三件一起做：render.yaml 取消注释 + 本行加回来 + EMAIL_REPLY_DIGEST_ENABLED=true。
  // DAPE E 段：看板上的动作真正被跑掉的那一步。上线时挂着 ?dry_run=1 只选不做。
  { service: 'execution-auto-run', jobName: 'execution-auto-run', schedule: '30 9 * * *', logsRuns: true, addedAt: '2026-08-06' },
  { service: 'factory-order-scheduler', jobName: 'factory-order-scheduler', schedule: '0 20 * * *', logsRuns: true },
  { service: 'factory-publish-sweeper', jobName: 'factory-publish-sweeper', schedule: '25 * * * *', logsRuns: true },
  { service: 'factory-publish-worker', jobName: 'factory-publish-worker', schedule: '5 * * * *', logsRuns: true },
  // 🔴 已暂停(2026-09-08,PM「停抓图」):抓来的图无人消费(改图那步是死代码),白花 Apify 钱。
  //    恢复三件套:render.yaml 取消注释 + 本行加回来 + 先把 stock-transform 接进调用链。
  // { service: 'factory-stock-refill', jobName: 'factory-stock-refill', schedule: '0 19 * * 1', logsRuns: true },
  { service: 'goal-current-value-refresh', jobName: 'goal-current-value-refresh', schedule: '0 3 * * *', logsRuns: true },
  { service: 'google-data-pullback-daily', jobName: 'google-data-pullback-daily', schedule: '0 3 * * *', logsRuns: true },
  { service: 'industry-ai-visibility-daily', jobName: 'industry-ai-visibility-daily', schedule: '30 2 * * *', logsRuns: true },
  { service: 'job-boards-weekly', jobName: 'job-boards-weekly', schedule: '0 2 * * 1', logsRuns: true },
  // 效果回流两条 —— 2026-08-04 补接线：代码早就有，但从没进过 render.yaml，
  // 于是 prescription_outcomes 一条记录都没有（「方案有没有用」从没被回答过）。
  { service: 'kpi-backfill', jobName: 'kpi-backfill', schedule: '20 6 * * *', logsRuns: true, addedAt: '2026-08-04' },
  { service: 'benchmark-accumulator', jobName: 'benchmark-accumulator', schedule: '40 7 * * 1', logsRuns: true, addedAt: '2026-08-04' },
  { service: 'keyword-snapshots-weekly', jobName: 'keyword-snapshots-weekly', schedule: '0 2 * * 1', logsRuns: true },
  { service: 'linkedin-progress-post-mon', jobName: 'linkedin-progress-post-mon', schedule: '30 20 * * 0', logsRuns: true, addedAt: '2026-08-20' },
  { service: 'linkedin-progress-post-thu', jobName: 'linkedin-progress-post-thu', schedule: '30 20 * * 3', logsRuns: true, addedAt: '2026-08-20' },
  // mailbox-sync-hourly 已于 2026-08-03 从 render.yaml 移除：它作为独立服务一次都没跑过
  // （新增服务要有人进 Render 点一次 Apply，而这件事不报任何错），现在挂在 messenger-hourly
  // 里跑。留在清单里会天天误报「没跑」——正是这套告警最怕的东西。
  { service: 'mailchimp-activity-daily', jobName: 'mailchimp-activity-sync', schedule: '40 4 * * *', logsRuns: true },
  { service: 'mailchimp-paid-tagging-daily', jobName: 'mailchimp-paid-tagging', schedule: '10 5 * * *', logsRuns: true, addedAt: '2026-09-02' },
  { service: 'mailchimp-suppression-sync-daily', jobName: 'mailchimp-suppression-sync', schedule: '20 5 * * *', logsRuns: true, addedAt: '2026-09-09' },
  // 补登记（2026-09-05 对账测试抓出）：Magic Insight 每日资讯管道，2026-08-20 就进了 render.yaml，
  // 清单里一直没有。老任务不补 addedAt（理由同上面 ad-readback-sweep-daily 那条）。
  { service: 'market-intel-daily', jobName: 'market-intel-daily', schedule: '0 18 * * *', logsRuns: true },
  // ⏸️ 降频到每 2 小时的计划（issue #1581，H14）已从这版代码抽出、暂不落地——
  //    Meta 生产企业验证（issue #1299）截至提交时仍未过，`/api/webhooks/meta/messenger`
  //    webhook 订阅打不开，这条 cron 仍是唯一在收真实私信的路径，现在降频只会让消息
  //    进系统变慢，没有任何东西补上腾出来的窗口。保持 `10 * * * *` 不变，等 webhook
  //    真正收到生产流量、验证过延迟确实缩短之后，再单独一个 PR 改这条 schedule
  //    （同时改 render.yaml 和下面 messenger-brief-hourly 那条，两处要一起动）。
  { service: 'messenger-hourly', jobName: 'messenger-sync-hourly', schedule: '10 * * * *', logsRuns: true },
  // 🔴 同一条 Render 服务里的**第二个**任务：startCommand 是 `curl 私信同步 && curl 私信简报`，
  //    两条 curl 各写各的运行记录。清单原来一条服务只登记一个 jobName，第二条就此隐形 ——
  //    这正是它能停 14 天没人发现的原因。
  //
  //    2026-09-07 实测（生产库）：私信同步 945 次、每小时都在跑，最近一次 09-06 14:10；
  //    私信简报 483 次，**最后一次是 08-23 00:12，之后一条都没有**。
  //    不是记录丢了：conversation_briefs 整张表最后被写的时间也停在 08-23 00:12:37，
  //    也就是说销售那边的客户需求卡从 8/23 起就没再更新过。
  //    停的原因在 Render 那一侧（本仓 render.yaml 这段自 2026-07-27 起没动过），
  //    从代码这边查不到，已作为单独一件事上报。这里先把它拉回监控范围。
  // 🔴 **不是 render.yaml 里的 cron，是 Inngest 上的事件消费者**（2026-09-07 改）。
  //    原来它是 messenger-hourly 那条服务里的第二条 curl，用 `&&` 接在私信同步后面 ——
  //    而 `&&` 守的是「网关有没有在超时前给 curl 响应」，不是「同步跑没跑完」。
  //    同步 8/17 起每轮约 140 秒、网关约 125 秒掐断返 524，第二条 curl 从 8/23 起一次
  //    都没执行过，销售的客户需求卡停更 14 天。现在改成同步跑完发一张条子、
  //    `cloud-messenger-brief-after-sync` 收到就写。
  //
  //    schedule 跟着 messenger-hourly 那条私信同步走，因为它由同步跑完发的条子触发——
  //    上面那条私信同步这次没有降频（见其注释），这里也保持 `10 * * * *` 不变。
  //
  //    🔴 **故意不填 `addedAt`。** 它不是新任务，是一条停了 14 天的老任务改了触发方式。
  //       填今天的日期会给它约 62 小时宽限期，而这段时间正好会盖住「Inngest 那边忘了
  //       重新 Sync、它其实还是没跑」—— 那恰恰是这次最该被喊出来的失败形态。
  { service: 'inngest:cloud-messenger-brief-after-sync', jobName: 'messenger-brief-hourly', schedule: '10 * * * *', logsRuns: true, scheduler: 'inngest' },
  { service: 'meta-leads-hourly', jobName: 'meta-leads-sync', schedule: '25 * * * *', logsRuns: true },
  { service: 'oztop-seo-optimizer', jobName: 'oztop-seo-optimizer', schedule: '0 5 * * 1', logsRuns: true },
  { service: 'pm-daily-todo', jobName: 'pm-daily-todo', schedule: '0 19 * * 0-4', logsRuns: true },
  { service: 'poll-visual-jobs', jobName: 'poll-visual-jobs', schedule: '15 * * * *', logsRuns: true },
  // ME2 Product Map 每日全量对账(webhook 的兜底)。表未 apply 前它会天天报 failed ——
  // 这是设计行为:不许把「什么都没干」显示成健康。apply migration 后自动转绿。
  { service: 'product-map-sync-daily', jobName: 'product-map-sync', schedule: '15 18 * * *', logsRuns: true, addedAt: '2026-08-15' },
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
  // 补登记（2026-09-05 对账测试抓出）：Tailor-made 导入/提取改成异步后加的扫尾任务，
  // 2026-08-28 进 render.yaml，清单里一直没有。老任务不补 addedAt（理由同上）。
  { service: 'tailor-made-jobs-sweeper', jobName: 'tailor-made-jobs-sweeper', schedule: '*/30 * * * *', logsRuns: true },
  { service: 'team-memory-sweeper', jobName: 'team-memory-sweeper', schedule: '*/30 * * * *', logsRuns: true },
  { service: 'viral-analyzer-worker', jobName: 'viral-analyzer-worker', schedule: '*/10 * * * *', logsRuns: true },
  { service: 'viral-discovery-weekly', jobName: 'viral-discovery-weekly', schedule: '0 0 * * *', logsRuns: true },
  { service: 'vision-analyzer', jobName: 'vision-analyzer', schedule: '50 * * * *', logsRuns: true },
  { service: 'weekly-seo-report', jobName: 'weekly-seo-report', schedule: '30 18 * * 0', logsRuns: true },
  { service: 'winner-reel-sync-daily', jobName: 'winner-reel-sync-daily', schedule: '0 15 * * *', logsRuns: true },
  { service: 'zhangqian-sweeper', jobName: 'zhangqian-sweeper', schedule: '35 * * * *', logsRuns: true },
  { service: 'zhuge-weekly-recalculate', jobName: 'zhuge-weekly-recalculate', schedule: '0 3 * * 1', logsRuns: true },

  // ── 不在 render.yaml，但确实有人在定时敲 ─────────────────────────────────────
  // 这两条 2026-09-07 才补进来。在此之前它们不在监控范围内，理由是个错的假设：
  // 「render.yaml 里没有 = 没人调度」。生产库的运行记录直接推翻了它。

  // GitHub Actions 调度（.github/workflows/goals-expiry-check.yml，声明 30 3 * * *）。
  // 🔴 GitHub 的免费定时工作流会大幅延迟：实测触发时刻在 04:10 ~ 15:35 之间飘，
  //    最长比声明的 03:30 晚了 12 小时。按每天算的宽限窗（24h × 2.5 = 60h）盖得住，
  //    所以照声明的表达式登记；哪天 GitHub 干脆不触发了，这里会喊。
  { service: 'goals-expiry-check.yml', jobName: 'goals-expiry-check', schedule: '30 3 * * *', logsRuns: true, scheduler: 'github-actions', addedAt: '2026-09-07' },

  // 仓库外：有人在 Render 后台手工建的一条 cron，每天 17:00 UTC 敲一次。
  // 路由自己的成本闸门把它节流成「距上次成功满 7 天才真跑」（PM 2026-07-31「每周省到底」，
  // 每月约 US$360 → 约 US$13），所以**真正落地的频率是每周一次**，登记按每周填。
  // 实测三次成功：08-16 / 08-23 / 08-30，都在周日 17:00 UTC，间隔正好 7 天。
  //
  // 🔴 绝对不要为了「补登记」把它加进 render.yaml —— 那会变成两个调度器同时敲，
  //    节流闸只挡得住重复的**采集**，挡不住重复的排班混乱，而且这活儿是花钱的。
  { service: 'render-dashboard:baseline-domains-monthly', jobName: 'baseline-domains-monthly', schedule: '0 17 * * 0', logsRuns: true, scheduler: 'external', addedAt: '2026-09-07' },

  // ── Inngest 自带定时器 ───────────────────────────────────────────────────────
  // 每周 SEO 快照。代码 2026-05-18 就写好了，但一次都没跑过（生产库 0 条运行记录），
  // 因为它每周要对每个在服务的客户各花一次 SEO 数据的钱 —— 2026-08-06 架构审计标成
  // 「等 PM 拍板」，**2026-09-07 PM 拍板开**，并要求按 Inngest 硬约束改成工作流。
  //
  // 🔴 schedule 这一列不许手抄：唯一定义在 src/lib/flywheel/seo-weekly.ts 的
  //    FLYWHEEL_SEO_WEEKLY_CRON，同目录的测试会断言两边一致。抄错的后果是健康检查
  //    按错的周期算逾期 —— 算错的告警和没有告警一样没用。
  { service: 'inngest:cloud-flywheel-seo-weekly-fanout', jobName: 'flywheel-seo-weekly', schedule: '15 5 * * 1', logsRuns: true, scheduler: 'inngest', addedAt: '2026-09-07' },
  // 🔴 schedule 这一列不许手抄：唯一定义在
  //    src/lib/inngest/functions/conversion-daily-pipeline.ts 的
  //    CONVERSION_DAILY_PIPELINE_CRON，抄错的后果同上一条 flywheel 注释。
  { service: 'inngest:cloud-conversion-daily-pipeline', jobName: 'conversion-daily-pipeline', schedule: '0 6 * * *', logsRuns: true, scheduler: 'inngest', addedAt: '2026-09-15' },
] as const

/**
 * 代码里写了运行记录（调了 `startCronRun`）、但**故意不给它排班**的接口。
 *
 * 存在理由：同目录的测试会拿「所有 cron 路由」跟上面这张清单对账，对不上就红。
 * 没有这份白名单的话，唯一能让测试变绿的办法就是给它排个班 —— 而其中有的排了
 * 就要花钱。所以：不排班可以，但必须在这里写清楚为什么，不许留悬案。
 *
 * 🔴 白名单不是「跳过检查」，它自己也被检查：
 *    · 名字必须真的还有路由在用（路由删了 = 这条该删）
 *    · 名字不许同时出现在 CRON_REGISTRY 里（排上班了 = 这条该删）
 *    两条任一不满足，测试红。否则白名单会慢慢变成第二个没人看的坟场。
 */
export const UNSCHEDULED_CRON_ROUTES: Readonly<Record<string, string>> = {
  // 邮箱同步**在跑**，只是不由这条路由跑：它挂在 messenger-hourly 那条已经在跑的
  // 任务里（2026-08-03 起，见 render.yaml 里那段注释和 messenger-sync-hourly 的文件头）。
  // 生产库实测：messenger-sync-hourly 每次的 summary 里都带 mailbox 那一段，
  // CTS 两个邮箱每小时都在收信。本路由保留只为单独手动触发，所以它没有运行记录是对的。
  'mailbox-sync': '邮箱同步已挂在 messenger-hourly 里跑（2026-08-03 起），本路由只留手动触发',

  // 「客人来信没回 → 每天一封汇总信」，2026-09-03 上线当天被 PM 叫停（名单里噪音占七成，
  // 一封都没发出去过）。render.yaml 里那段整段注释掉了，清单里也同步摘掉 ——
  // 留着会天天误报「没跑」。恢复时三件一起做，见 CRON_REGISTRY 里那段注释。
  'email-reply-digest': '2026-09-03 PM 叫停，render.yaml 那段已注释掉，恢复条件写在 CRON_REGISTRY 的注释里',

  // 素材抓取,2026-09-08 PM「停抓图」叫停:抓来的图无人消费(改图那步是死代码),白花 Apify 钱。
  // render.yaml + CRON_REGISTRY 那行都注释掉了;路由留着并加了 FACTORY_STOCK_REFILL_ENABLED
  // 开关兜底(默认关)。恢复条件见 CRON_REGISTRY 里那段注释。
  'factory-stock-refill': '2026-09-08 PM 停抓图,render.yaml/registry 已注释,恢复条件见 CRON_REGISTRY 注释',

  // Creatomate 渲染工作流（src/lib/inngest/functions/factory-creatomate-render.ts）不是
  // 周期任务——它由客户内容"确认"按钮按需触发（一天可能 0 次也可能 N 次），设计上就不该
  // 排班。回执写 cron_run_logs 只是复用这套"有独立历史、健康检查看得见"的落点（spec
  // docs/specs/2026-09-09-creatomate-connector-spec-v1.md §4.4），job_name 恒为
  // 'creatomate-render'，具体是哪条渲染由 summary.source_record_id 区分，不是按周期对账。
  'creatomate-render': '按需事件触发（内容确认时），非周期任务，不适用 CRON_REGISTRY 的排班对账',
}
