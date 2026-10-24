import { DISPATCH_OWNED_SERVICES } from './dispatch/catalog'

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
export type CronScheduler = 'render' | 'github-actions' | 'external' | 'inngest' | 'dispatcher'

/**
 * 这个任务跑成之后**本该往哪些表写新数据**。
 *
 * 🔴 加这个字段是因为 2026-09-23 的事故：`google-data-pullback-daily` 每天跑
 *    `status='completed'`，但下游 `ad_health_narratives` 从 9/20 起一行没写。
 *    现有 `judgeJob` 只看 `cron_run_logs.status`，任务写"completed"就算健康——
 *    上游数据源断了、路由里的写这一步被跳过，一样绿灯放行。断了 3 天没人察觉。
 *
 *    这里声明"我跑完该写哪些表"，配合 `silentSuccess` 判定，就能把这类
 *    "跑成了但没写出东西"抓出来。
 *
 * · `table` —— 目标表名（public schema）
 * · `freshnessHours` —— 这个表多久没新行就算 stale。通常应比 cron 间隔略宽
 *   （日 cron 26h，周 cron 8 天，等等）—— 跟 overdue 阈值同一个逻辑
 * · `timestampColumn` —— 判 stale 用哪个时间列，默认 `updated_at`。
 *   upsert 表用 `updated_at` 更敏感（re-run 不改 `created_at`）；
 *   insert-only 表用 `created_at` 也一样
 */
export interface CronOutputTable {
  table: string
  freshnessHours: number
  timestampColumn?: string
  /**
   * 这个任务**确实存在「这一轮本来就没东西可写」的合法空轮**吗？
   *
   * 🔴 默认 `false`，而且**默认必须是 false**（Codex 复审 2026-09-23 P2）。
   *    判「本轮该不该产出」的唯一现成信号是运行记录里的 `processed`，可这个字段
   *    **没有统一语义**：`google-data-pullback-daily` 在读客户 Meta 账户报错时会
   *    忽略错误、得到空 work，然后以 `processed: 0` + `completed` 收尾 ——
   *    把 `processed=0` 无条件当成「合法空轮」，正好会把它数据源断线这件事再藏一次，
   *    而那恰恰就是当初加 `outputTables` 要抓的那个事故。
   *
   *    所以空轮豁免改成**任务级显式声明**：只有确实会有合法空轮、而且
   *    `processed` 在这个任务里真的等于「挑出了几个候选」的，才填 `true`。
   *    不确定 = 不填 —— 宁可偶尔多报一条，也不要把断线又藏回去。
   */
  emptyRoundsAreLegitimate?: boolean
}

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
  /**
   * 这个任务跑完**本该**往哪些表写新行。声明了才做下游对账；不声明 = 只查
   * `cron_run_logs`（跟老行为一致）。用来抓"任务跑成了但没写出东西"这类
   * 沉默死亡（2026-09-23 事故）。
   */
  outputTables?: readonly CronOutputTable[]
}

const CRON_REGISTRY_ENTRIES = [
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
  // 每 6 小时一轮：2026-09-16 降频（commit 2a17a85f2，3 小时 → 6 小时）。此前这里和 render.yaml 的注释一直写“每 3 小时”，
  // 登记表因此按 3 小时算逾期；2026-10-21 对账测试抓出（docs/ledger/2026-10-21-cron-registry-drift-schedules-and-unowned-writers.md）。
  { service: 'ad-entity-snapshot', jobName: 'ad-entity-snapshot', schedule: '30 */6 * * *', logsRuns: true, addedAt: '2026-09-14' },
  { service: 'agent-learning-rollup', jobName: 'agent-learning-rollup', schedule: '0 7 * * 1', logsRuns: true },
  // IMPACT 的 Tune 段。路由早就写好了，但从 Phase 23.C 起**一直没登记调度** ——
  // cron_run_logs 里零条运行记录，而 Check 段 2026-08~09 产出了 285 条结论。
  // 「没通电」和「一切正常」在监控里长得一模一样，正是这张表要解决的那个病。
  { service: 'memory-extractor', jobName: 'memory-extractor', schedule: '30 6 * * *', logsRuns: true, addedAt: '2026-09-06' },
  // 周日 UTC 18:00 = 周一新西兰 06:00（NZST）。PM 2026-09-16 拍板“新西兰早晨窗口”，从周一 01:00 UTC 挪过来，登记表此前没跟着改。
  { service: 'ai-tracker-weekly', jobName: 'ai-tracker-weekly', schedule: '0 18 * * 0', logsRuns: true },
  { service: 'anomaly-detector-daily', jobName: 'anomaly-detector-daily', schedule: '0 5 * * *', logsRuns: true },
  { service: 'attribution-cron', jobName: 'attribution-cron', schedule: '0 */6 * * *', logsRuns: true },
  { service: 'blog-stuck-generating-sweeper', jobName: 'blog-stuck-generating-sweeper', schedule: '45 * * * *', logsRuns: true },
  { service: 'blog-weekly', jobName: 'blog-weekly', schedule: '0 3 * * 2', logsRuns: true },
  { service: 'content-factory-intake', jobName: 'content-factory-intake', schedule: '0 22 * * *', logsRuns: true },
  // 运行记录自己的清理任务。以前是 cron_run_logs 表上的 AFTER INSERT 触发器，
  // 每天 400~600 次插入就跑 400~600 次全表 DELETE，并发时会死锁 —— 而死锁让插入失败，
  // 也就是让这套监控自己瞎掉。2026-09-07 改成每天一次的独立任务。
  { service: 'cron-run-logs-cleanup', jobName: 'cron-run-logs-cleanup', schedule: '50 16 * * *', logsRuns: true, addedAt: '2026-09-07' },
  // cts-seo-optimizer 于 2026-09-20 退役（PM 拍板）：render.yaml 里那条定时任务
  // 在同一个 PR 里删掉了，换成 Inngest 原生的 cloud-seo-meta-cycle-fanout。
  // 这里同步摘掉登记：留着会天天误报「没跑」，理由同 email-reply-digest。
  { service: 'daily-cron-digest', jobName: 'daily-cron-digest', schedule: '0 6 * * *', logsRuns: true },
  { service: 'diagnostic-weekly', jobName: 'diagnostic-weekly', schedule: '0 8 * * 1', logsRuns: true, addedAt: '2026-08-03' },
  // 客人来信没人回 → 每天早上给销售发一封汇总信。UTC 20:00 = 次日 NZ 08:00（NZST=UTC+12）。
  // email-reply-digest 于 2026-09-03 被 PM 叫停（上线当天，一封都没发出去过；仓库里已注释，服务器上是否真停见台账卡 2026-10-21-render-orphan-cron-services-9）：
  // 名单里噪音占七成 —— 现有排除只挡「自己人域名」和「同行域名」，挡不住陌生公司
  // 群发的推销，而排序按「等最久」，等最久的恰好是没人理的营销邮件。
  // render.yaml 里那段已注释掉，这里同步摘掉登记：留着会天天误报「没跑」，
  // 正是这套告警最怕的东西（跟 mailbox-sync-hourly 同一个理由）。
  // 恢复时三件一起做：render.yaml 取消注释 + 本行加回来 + EMAIL_REPLY_DIGEST_ENABLED=true。
  // DAPE E 段：看板上的动作真正被跑掉的那一步。上线时挂着 ?dry_run=1 只选不做。
  // 🔴 仓库里已暂停(2026-10-07,PM 没人读就关审计;服务器上是否真停见台账卡 2026-10-21-render-orphan-cron-services-9;恢复三件套见 render.yaml 对应注释)
  // { service: 'execution-auto-run', jobName: 'execution-auto-run', schedule: '30 9 * * *', logsRuns: true, addedAt: '2026-08-06' },
  { service: 'factory-order-scheduler', jobName: 'factory-order-scheduler', schedule: '0 20 * * *', logsRuns: true },
  { service: 'factory-publish-sweeper', jobName: 'factory-publish-sweeper', schedule: '25 * * * *', logsRuns: true },
  { service: 'factory-publish-worker', jobName: 'factory-publish-worker', schedule: '5 * * * *', logsRuns: true },
  // 🔴 仓库里已暂停(2026-09-08,PM「停抓图」;服务器上是否真停见台账卡 2026-10-21-render-orphan-cron-services-9):抓来的图无人消费(改图那步是死代码),白花 Apify 钱。
  //    恢复三件套:render.yaml 取消注释 + 本行加回来 + 先把 stock-transform 接进调用链。
  // { service: 'factory-stock-refill', jobName: 'factory-stock-refill', schedule: '0 19 * * 1', logsRuns: true },
  // 每天 UTC 17:30（新西兰早 05:30）。PM 2026-09-16 “新西兰早晨窗口”，从 03:00 UTC 挪过来，登记表此前没跟着改。
  { service: 'goal-current-value-refresh', jobName: 'goal-current-value-refresh', schedule: '30 17 * * *', logsRuns: true },
  // 2026-09-23 事故防御：这个任务负责每天写 ad_daily_insights + ad_health_narratives，
  // 但 9/20-9/23 三天 status='completed' 却一行没写（上游数据源断了，写下游被跳过），
  // 现有 judgeJob 只看 cron_run_logs 状态放行——outputTables 声明就是补这个缝：
  // 26h 没新行就算 silent_success，红灯喊出来。日 cron × 2.5 宽限 ≈ 26h（同 overdue 逻辑）。
  // 2026-09-16 起每天 UTC 17:00（此前 03:00，PM “新西兰早晨窗口”）；下面 26h 的新鲜度阈值对日 cron 不变。
  { service: 'google-data-pullback-daily', jobName: 'google-data-pullback-daily', schedule: '0 17 * * *', logsRuns: true,
    outputTables: [
      { table: 'ad_daily_insights', freshnessHours: 26 },
      { table: 'ad_health_narratives', freshnessHours: 26 },
      // 2026-09-25 事故：读广告配置 400 → 所有客户的诊断 / 经营状态静默跳过，
      // 但账户级体检照写 ad_health_narratives，上面两条都是绿的。经营状态每个
      // 有 Meta 账户的客户每天必写一行，它停了就是整条诊断链停了。
      // 只看全表最新一行，所以只抓「所有客户一起停」；个别客户停由 summary.errors 的
      // ad_config / ads_growth_state 兜。所有广告客户都被人手暂停时它会误报一条（子牙 / 魏征复审，可接受）。
      { table: 'ads_growth_states', freshnessHours: 26 },
    ] },
  { service: 'industry-ai-visibility-daily', jobName: 'industry-ai-visibility-daily', schedule: '30 16 * * 1', logsRuns: true },
  // 🔴 仓库里已暂停(2026-10-07,PM 没人读就关审计;服务器上是否真停见台账卡 2026-10-21-render-orphan-cron-services-9;恢复三件套见 render.yaml 对应注释)
  // { service: 'job-boards-weekly', jobName: 'job-boards-weekly', schedule: '0 2 * * 1', logsRuns: true },
  // 效果回流两条 —— 2026-08-04 补接线：代码早就有，但从没进过 render.yaml，
  // 于是 prescription_outcomes 一条记录都没有（「方案有没有用」从没被回答过）。
  { service: 'kpi-backfill', jobName: 'kpi-backfill', schedule: '20 6 * * *', logsRuns: true, addedAt: '2026-08-04' },
  { service: 'benchmark-accumulator', jobName: 'benchmark-accumulator', schedule: '40 7 * * 1', logsRuns: true, addedAt: '2026-08-04' },
  { service: 'keyword-snapshots-weekly', jobName: 'keyword-snapshots-weekly', schedule: '0 2 * * 1', logsRuns: true },
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
  //    🔴 **2026-09-23 再补一道：声明下游表。** 这条链路又停了一次（9/20 19:11 起 3 天），
  //       这次的形状是「每小时都开跑、然后段撞穿网关不返回」，运行记录停在 `running`。
  //       状态位这一侧的两个洞已经分别补掉（函数配上 `onFailure` 收口、health 的卡死
  //       判定改看回退 60 分钟那一条），这里再加一层**只认真实产出**的判据：
  //       `conversation_briefs` 超过 3 小时没新行就红灯 —— 不管运行记录写的是什么。
  //       小时级任务 × 2.5 倍宽限 ≈ 2.5h，取 3h（同 overdue 的宽限口径）。
  //       `generated_at` 才是「这张卡这一轮被写过」的时刻；`updated_at` 同样会被写，
  //       但前者语义更直，别人改动时不容易误解。
  //    🔴 **2026-09-23 Codex 复审再补一道：连续 3 小时没有新私信对话，或所有对话都
  //       已有最新简报时，这个任务会合法 `processed=0` 收工——这种情况下
  //       `conversation_briefs.generated_at` 本来就不该前进，不是故障。判定这边
  //       （`checkDownstreamFreshness` in `health.ts`）已经配上运行回执的
  //       `RunActivityReader`：窗口内查不到任何一次 `processed > 0` 的运行记录
  //       时不报——只有「候选是有的、但没写下去」才算真的沉默死。
  { service: 'inngest:cloud-messenger-brief-after-sync', jobName: 'messenger-brief-hourly', schedule: '10 * * * *', logsRuns: true, scheduler: 'inngest',
    outputTables: [{
      table: 'conversation_briefs',
      freshnessHours: 3,
      timestampColumn: 'generated_at',
      // 这个任务**确实**有合法空轮：连续几小时没有新私信、或所有对话都已经有最新的卡时，
      // `loadDueBriefs` 合法返回 0 条候选，`generated_at` 本来就不该前进。
      // 而它的 `processed` 写的正是「这一轮挑出了几个候选」（见 messenger-brief-after-sync
      // 的 `run.finish({ processed: due.list.length })`），语义对得上，可以当判据。
      emptyRoundsAreLegitimate: true,
    }] },
  // 服务名叫 hourly，但 2026-09-16（commit 2a17a85f2）起实际是每 2 小时一轮（偶数 UTC 小时的第 25 分）。
  { service: 'meta-leads-hourly', jobName: 'meta-leads-sync', schedule: '25 */2 * * *', logsRuns: true },
  { service: 'pm-daily-todo', jobName: 'pm-daily-todo', schedule: '0 19 * * 0-4', logsRuns: true },
  { service: 'poll-visual-jobs', jobName: 'poll-visual-jobs', schedule: '15 * * * *', logsRuns: true },
  // ME2 Product Map 每日全量对账(webhook 的兜底)。表未 apply 前它会天天报 failed ——
  // 这是设计行为:不许把「什么都没干」显示成健康。apply migration 后自动转绿。
  { service: 'product-map-sync-daily', jobName: 'product-map-sync', schedule: '15 18 * * *', logsRuns: true, addedAt: '2026-08-15' },
  { service: 'prescription-weekly', jobName: 'prescription-weekly', schedule: '0 8 * * 2', logsRuns: true, addedAt: '2026-08-04' },
  { service: 'cms-connection-retest', jobName: 'cms-connection-retest', schedule: '10 6 * * *', logsRuns: true, addedAt: '2026-08-05' },
  { service: 'proposal-view-digest', jobName: 'proposal-view-digest', schedule: '0 19 * * *', logsRuns: true },
  // 2026-09-16 降频（commit 2a17a85f2）：每小时整点；此前登记的是每 30 分钟。
  { service: 'prospecting-sweep', jobName: 'prospecting-sweep', schedule: '0 * * * *', logsRuns: true },
  { service: 'reputation-snapshots-weekly', jobName: 'reputation-snapshots-weekly', schedule: '30 3 * * 1', logsRuns: true },
  { service: 'seo-patrol-daily', jobName: 'seo-patrol-daily', schedule: '0 4 * * *', logsRuns: true },
  { service: 'seo-weekly-list', jobName: 'seo-weekly-list', schedule: '30 4 * * 1', logsRuns: true, addedAt: '2026-10-04' },
  { service: 'site-audit-cron', jobName: 'site-audit-cron', schedule: '0 2 * * *', logsRuns: true },
  { service: 'site-audit-weekly', jobName: 'site-audit-weekly', schedule: '0 1 * * 0', logsRuns: true },
  // 2026-09-16 降频（commit 2a17a85f2）：每小时整点；此前登记的是每 30 分钟。
  { service: 'social-comment-autoreply', jobName: 'social-comment-autoreply', schedule: '0 * * * *', logsRuns: true },
  { service: 'social-engagement-pullback', jobName: 'social-engagement-pullback', schedule: '0 4 * * *', logsRuns: true },
  // 补登记（2026-09-05 对账测试抓出）：Tailor-made 导入/提取改成异步后加的扫尾任务，
  // 2026-08-28 进 render.yaml，清单里一直没有。老任务不补 addedAt（理由同上）。
  { service: 'tailor-made-jobs-sweeper', jobName: 'tailor-made-jobs-sweeper', schedule: '*/30 * * * *', logsRuns: true },
  // 🔴 仓库里已暂停(2026-10-07,PM 没人读就关审计;服务器上是否真停见台账卡 2026-10-21-render-orphan-cron-services-9;恢复三件套见 render.yaml 对应注释)
  // { service: 'team-memory-sweeper', jobName: 'team-memory-sweeper', schedule: '*/30 * * * *', logsRuns: true },
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
  // 调度改由 dispatcher 每天 17:00 UTC 敲门（跟原先后台那条一样）。
  // 健康检查仍按每周：跳过的日子不写成功记录，真正采集大约 7 天一次。
  // 切流后删掉 Render 上的 baseline-domains-weekly，不要两条一起敲。
  { service: 'render-dashboard:baseline-domains-monthly', jobName: 'baseline-domains-monthly', schedule: '0 17 * * 0', logsRuns: true, addedAt: '2026-09-07' },

  // 7 本跨客户经验手册（Claude 持久记忆，不在这个仓库）每周过期巡检。触发方是
  // 仓库外的 Claude scheduled task（~/.claude/scheduled-tasks/playbook-staleness-weekly/
  // SKILL.md），不在 render.yaml 里——本地每周一 08:30 NZT 跑，POST 结果给这个接口。
  {
    service: 'claude-scheduled-task:playbook-staleness-weekly',
    jobName: 'playbook-staleness-weekly',
    schedule: '30 8 * * 1',
    logsRuns: true,
    scheduler: 'external',
    addedAt: '2026-09-24',
  },

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
  // 每周竞品快照。competitor_snapshots 这张表 2026-05-18 就建好了，唯一的写入方是一个纯
  // 手动 POST 接口，从来没有 cron；那个接口 2026-08-05 死管道清理时被当陪葬删掉，表一直是空的。
  // 2026-09-20 审计发现并重写，PM 拍板开，先只给 CTS（seo_config.competitor_watch_enabled）。
  //
  // 🔴 schedule 这一列不许手抄：唯一定义在 src/lib/competitors/watch.ts 的
  //    COMPETITOR_WATCH_CRON，同目录的测试会断言两边一致。
  { service: 'inngest:cloud-competitor-watch-weekly-fanout', jobName: 'competitor-watch-weekly', schedule: '45 5 * * 1', logsRuns: true, scheduler: 'inngest', addedAt: '2026-09-20' },
  // SEO 标题自动优化：每周一的「选页→过闸→改标题」主链（2026-09-20 起在线上跑，但此前**没登记**，
  // 也就是说它哪天因为没 Sync 而安静地不跑了，这里不会喊——「不在监控范围」和「一切正常」在告警里长得一样）。
  // 🔴 jobName 取的是主链最后一步的收尾回执（seo-meta-cycle-step6-completed）：每个客户的每次运行
  //    不管走到哪一步（跳过、没适配器、跑完）都会写这一条，所以它是「这一周这条链醒过」的唯一证据。
  // 🔴 schedule 不许手抄：唯一定义在 src/lib/seo-meta/cycle/roster.ts 的 META_CYCLE_CRON，同目录测试会断言一致。
  { service: 'inngest:cloud-seo-meta-cycle-fanout', jobName: 'seo-meta-cycle-step6-completed', schedule: '30 5 * * 1', logsRuns: true, scheduler: 'inngest' },
  // SEO 标题自动优化的「验收」：每天一次，给改满 18 天的页查目标词排名（影子期，只写 seo_meta_log）。
  // 🔴 schedule 不许手抄：唯一定义在 src/lib/seo-meta/cycle/rank-sampler.ts 的 RANK_SAMPLER_CRON。
  // 🔴 新增函数，部署后必须去 Inngest 后台 Sync 一次，否则安静地不跑——这条登记就是为了把它喊出来。
  { service: 'inngest:cloud-seo-meta-rank-sampler-fanout', jobName: 'seo-meta-rank-sampler', schedule: '20 20 * * *', logsRuns: true, scheduler: 'inngest', addedAt: '2026-10-04' },
  // 每周 AI 可见度追踪（GEO）灰度迁移。旧 Render cron `ai-tracker-weekly`（上面那条老登记）
  // 原样保留、对没开灰度开关的客户继续跑；这条新登记只覆盖开了
  // `seo_config.ai_visibility_inngest_enabled` 的客户，故意用不同的 jobName——两条链路
  // 覆盖范围不同，混进同一份健康检查会看不出「这周是哪条链路给这个客户出的数据」。
  //
  // 🔴 schedule 这一列不许手抄：唯一定义在 src/lib/ai-tracker/weekly-fanout.ts 的
  //    AI_VISIBILITY_WEEKLY_CRON，同目录的测试会断言两边一致。
  // 线索 → 客户指定的 Google 表格。每小时 20 分跑，排在 meta-leads-sync（整点）之后。
  // 日历上带日期的验证事项，每天新西兰 07:20 核对一遍（第一步：只读）。
  // 🔴 schedule 不许手抄：唯一定义在 src/lib/inngest/functions/calendar-closure-audit.ts 的 CALENDAR_CLOSURE_CRON。
  // 🔴 新增函数，部署后必须去 Inngest 后台 Sync 一次，否则安静地不跑——这条登记就是为了把它喊出来。
  // 推广计划每天新西兰 07:10 自己查一遍（只读：不发布、不扣费、不外发），回执写 cron_run_logs 并发事件 promo_plan.watch.checked。
  // 🔴 schedule 不许手抄：唯一定义在 src/lib/inngest/functions/promo-plan-daily-watch.ts 的 PROMO_WATCH_CRON。
  // 🔴 新增函数，部署后必须去 Inngest 后台 Sync 一次，否则安静地不跑。
  { service: 'inngest:cloud-promo-plan-daily-watch', jobName: 'promo-plan-daily-watch', schedule: '10 7 * * *', logsRuns: true, scheduler: 'inngest', addedAt: '2026-10-15' },
  // 广告开投前「追踪与环境就绪」检查：每天新西兰 07:00 查一遍（只读：不写 Meta / GA4 / 官网，不发布，不扣费），
  // 回执写 cron_run_logs 并发事件 ads.tracking_preflight.checked。
  // 🔴 schedule 不许手抄：唯一定义在 src/lib/inngest/functions/ads-tracking-preflight.ts 的 TRACKING_PREFLIGHT_CRON。
  { service: 'inngest:cloud-ads-tracking-preflight', jobName: 'ads-tracking-preflight', schedule: '0 7 * * *', logsRuns: true, scheduler: 'inngest', addedAt: '2026-10-20' },
  // 广告心跳：每小时新西兰第 5 分只读采样一遍 Meta（不发布、不改广告、不扣费），
  // 默认 `dry` 且默认一个客户都不跑（要 AD_HEARTBEAT_MODE=live + AD_HEARTBEAT_CLIENT_IDS 才真跑）。
  // 每一轮（含空轮）都写一行运行记录，它自己哪天停了才看得出来。
  // 🔴 schedule 不许手抄：唯一定义在 src/lib/inngest/functions/ad-heartbeat.ts 的 AD_HEARTBEAT_CRON
  //    （带 TZ=Pacific/Auckland 前缀；每小时第 5 分在任何整小时偏移的时区里是同一个周期，所以这里写不带时区的 5 * * * *）。
  // 🔴 新增函数，部署后必须去 Inngest 后台 Sync 一次，否则安静地不跑——这条登记就是为了把它喊出来。
  { service: 'inngest:cloud-ad-heartbeat', jobName: 'ad-heartbeat', schedule: '5 * * * *', logsRuns: true, scheduler: 'inngest', addedAt: '2026-10-21' },
  // 开投后「自动补排」读回：每小时看一眼，窗口里官方账户一开始花钱就自己补排 T+1h / T+24h 读回（只读）。
  // 窗口外的整点也留一行运行记录（processed=0），它自己哪天停了才看得出来。
  // 🔴 schedule 不许手抄：唯一定义在 src/lib/inngest/functions/ads-tracking-launch-watch.ts 的 LAUNCH_WATCH_CRON。
  { service: 'inngest:cloud-ads-tracking-launch-watch', jobName: 'ads-tracking-launch-watch', schedule: '20 * * * *', logsRuns: true, scheduler: 'inngest', addedAt: '2026-10-20' },
  { service: 'inngest:cloud-calendar-closure-audit', jobName: 'calendar-closure-audit', schedule: '20 7 * * *', logsRuns: true, scheduler: 'inngest', addedAt: '2026-10-08' },
  { service: 'inngest:cloud-lead-sheet-sync-fanout', jobName: 'lead-sheet-sync', schedule: '20 * * * *', logsRuns: true, scheduler: 'inngest', addedAt: '2026-09-24' },
  { service: 'inngest:cloud-ai-visibility-weekly-fanout', jobName: 'ai-visibility-tracker-weekly', schedule: '0 6 * * 1', logsRuns: true, scheduler: 'inngest', addedAt: '2026-09-21' },
  // 「客人填了表还没人回」每天一封汇总信。新西兰早上 8 点（Inngest 的 cron 带 TZ=）。
  //
  // 🔴 为什么一定要登记：`LEAD_FOLLOWUP_DIGEST_ENABLED` 默认是关的，所以上线后
  //    「信箱里没信」本来就是预期行为。等有人打开开关、信还是不来，没有这条登记
  //    就分不出「Inngest 忘了重新 Sync 所以函数压根没注册」和「今天真的没人欠跟进」。
  //    这类登记的全部意义就是把「安静地不跑」喊出来。
  { service: 'inngest:cloud-crm-lead-followup-digest', jobName: 'crm-lead-followup-digest', schedule: '0 8 * * *', logsRuns: true, scheduler: 'inngest', addedAt: '2026-09-24' },
  // 李白 · 提示词库月检（agent 自治计划 B2）：cron 每周二 NZ 09:00 醒，函数里只在当月 1–7 号
  // 真跑（标准 cron 的日/周字段是「或」，写不出「第一个周二」），其余周二写一条 skipped 回执。
  // 所以按「每周二」对账是对的：每周都有一行。周期与代码常量 LIBAI_PROMPT_AUDIT_CRON 一致。
  { service: 'inngest:cloud-libai-prompt-library-monthly', jobName: 'libai-prompt-library-monthly', schedule: '0 9 * * 2', logsRuns: true, scheduler: 'inngest', addedAt: '2026-09-25' },
  // 司马迁 · 口碑周巡（agent 自治计划 B2）：每周四新西兰 09:00 读本周新 Google 评价、起草回复，
  // 一律不发，只写回执给今日待办拉。周期与 src/lib/inngest/functions/simaqian-reputation-weekly.ts
  // 的 SIMAQIAN_CRON 一致（同目录测试断言两边相等）。避开周五周六。
  { service: 'inngest:cloud-simaqian-reputation-weekly', jobName: 'simaqian-reputation-weekly', schedule: '0 9 * * 4', logsRuns: true, scheduler: 'inngest', addedAt: '2026-09-25' },
  // Per-page daily Google Search Console store (item 4, PR-A): a daily 18:30 UTC fan-out sends one
  // pull order per GSC-connected client (the last 5 days) plus up to 3 backfill months per client.
  // Its output is the receipts table: no new receipt for 26 h means the chain did not run (for
  // example Inngest was not re-synced after deploy) or dispatched nothing.
  //
  // 🔴 timestampColumn is `started_at`, NOT `finished_at`: `finished_at` is NULL while an order runs,
  //    and the freshness prober sorts DESC, where Postgres puts NULLs first — a running or stuck
  //    receipt would read as "table never written", a false alarm every evening. A stuck order is
  //    still reported: its cron_run_logs row stays `running` and the stuck check catches it.
  // 🔴 schedule must not be hand-copied: the only definition is GSC_PAGE_DAILY_CRON in
  //    src/lib/gsc/page-daily-plan.ts, and registry.test.ts asserts they are equal.
  { service: 'inngest:cloud-gsc-page-daily-fanout', jobName: 'gsc-page-daily', schedule: '30 18 * * *', logsRuns: true, scheduler: 'inngest', addedAt: '2026-09-26',
    outputTables: [{ table: 'gsc_page_fetch_receipts', freshnessHours: 26, timestampColumn: 'started_at' }] },
  // The pull orders of the same chain, under their own job name. Event-triggered: the fan-out above sends one
  // event per order, so this runs on the fan-out's daily schedule — registered the way messenger-brief-hourly
  // (an event consumer of a scheduled upstream) is. A separate job name keeps one client's failed order from
  // hiding behind the next order's row, and keeps the dispatch row's own report visible.
  // No outputTables: the receipts table is declared once, on the fan-out entry. If no client is GSC-connected,
  // no order is sent and this entry will look overdue — the only legitimate silence.
  // 🔴 schedule must not be hand-copied: it is the upstream fan-out's GSC_PAGE_DAILY_CRON (registry.test.ts).
  { service: 'inngest:cloud-gsc-page-daily-pull', jobName: 'gsc-page-daily-pull', schedule: '30 18 * * *', logsRuns: true, scheduler: 'inngest', addedAt: '2026-09-26' },
  // Per-(query, page) daily Google Search Console store: the same chain as the two entries above run with its own
  // event / job names / receipts table (docs/specs/2026-10-13-gsc-query-page-daily-design.md). Its first run also
  // starts the 16-month backfill (4 months per client per day, so about 4 days).
  // 🔴 schedule must not be hand-copied: the only definition is GSC_QUERY_PAGE_DAILY_CRON in
  //    src/lib/gsc/query-page-daily-store.ts, and registry.test.ts asserts they are equal.
  // 🔴 timestampColumn is `started_at` for the same reason as the per-page chain (finished_at is NULL while running).
  { service: 'inngest:cloud-gsc-query-page-daily-fanout', jobName: 'gsc-query-page-daily', schedule: '0 19 * * *', logsRuns: true, scheduler: 'inngest', addedAt: '2026-10-13',
    outputTables: [{ table: 'gsc_query_page_fetch_receipts', freshnessHours: 26, timestampColumn: 'started_at' }] },
  // The pull orders of the chain above, under their own job name (same reasons as gsc-page-daily-pull).
  { service: 'inngest:cloud-gsc-query-page-daily-pull', jobName: 'gsc-query-page-daily-pull', schedule: '0 19 * * *', logsRuns: true, scheduler: 'inngest', addedAt: '2026-10-13' },
  // 每日计划图文 Post 自动发 Facebook 的每小时扫一遍：新西兰每小时第 20 分（默认只演练，真发要 Ray 授权），
  // 每一轮（含空轮）都写一行运行记录。设计稿 docs/specs/2026-10-10-daily-plan-auto-publish-design.md。
  // 2026-10-21 才补登记：此前这个会对外发布的函数不在任何名单里，「没通电」和「一切正常」在告警里长得一样。
  // 🔴 schedule 不许手抄：唯一定义在 src/lib/inngest/functions/daily-plan-auto-publish.ts 的 DAILY_PLAN_AUTO_PUBLISH_CRON
  //    （带 TZ=Pacific/Auckland 前缀；每小时第 20 分在任何整小时偏移的时区里是同一个周期，所以这里写不带时区的 20 * * * *，
  //    该函数的测试断言两边一致）。
  // 🔴 故意不写 addedAt：它早就在跑（生产库近 48 小时 48 行运行记录），不是新函数；哪天停了要立刻喊。
  { service: 'inngest:cloud-daily-plan-auto-publish', jobName: 'daily-plan-auto-publish', schedule: '20 * * * *', logsRuns: true, scheduler: 'inngest' },
  // Story 轻量发布每 10 分钟扫一遍（新西兰时区；默认只演练，真发要 STORY_AUTO_PUBLISH_LIVE=true 且客户在名单里），
  // 每一轮都写一行运行记录。设计稿 docs/specs/2026-10-12-story-lite-design.md。2026-10-21 补登记，理由同上一条。
  // 🔴 schedule 不许手抄：唯一定义在 src/lib/inngest/functions/story-lite-publish.ts 的 STORY_LITE_PUBLISH_CRON（该函数的测试断言两边一致）。
  { service: 'inngest:cloud-story-lite-publish', jobName: 'story-lite-publish', schedule: '*/10 * * * *', logsRuns: true, scheduler: 'inngest' },

  // Render 上只留这三条。它们自己很快返回，到点的旧接口在 web 进程里接着跑。
  { service: 'cron-dispatch-frequent', jobName: 'cron-dispatch-frequent', schedule: '*/5 * * * *', logsRuns: true, addedAt: '2026-10-24' },
  { service: 'cron-dispatch-daily', jobName: 'cron-dispatch-daily', schedule: '*/5 * * * *', logsRuns: true, addedAt: '2026-10-24' },
  { service: 'cron-dispatch-weekly', jobName: 'cron-dispatch-weekly', schedule: '*/5 * * * *', logsRuns: true, addedAt: '2026-10-24' },
] as const

export const CRON_REGISTRY: readonly CronRegistryEntry[] = CRON_REGISTRY_ENTRIES.map((entry) =>
  DISPATCH_OWNED_SERVICES.has(entry.service) ? { ...entry, scheduler: 'dispatcher' as const } : entry,
)

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
  'email-reply-digest': '2026-09-03 PM 叫停；仓库里 render.yaml 那段已注释掉（2026-10-21 核）；服务器上是否真停以 Render 读回为准，见台账卡 2026-10-21-render-orphan-cron-services-9；恢复条件写在 CRON_REGISTRY 的注释里',

  // 素材抓取,2026-09-08 PM「停抓图」叫停:抓来的图无人消费(改图那步是死代码),白花 Apify 钱。
  // render.yaml + CRON_REGISTRY 那行都注释掉了;路由留着并加了 FACTORY_STOCK_REFILL_ENABLED
  // 开关兜底(默认关)。恢复条件见 CRON_REGISTRY 里那段注释。
  'factory-stock-refill': '2026-09-08 PM 叫停抓图；仓库里 render.yaml 与登记行已注释（2026-10-21 核）；服务器上是否真停以 Render 读回为准，见台账卡 2026-10-21-render-orphan-cron-services-9；恢复条件见 CRON_REGISTRY 注释',

  // Creatomate 渲染工作流（src/lib/inngest/functions/factory-creatomate-render.ts）不是
  // 周期任务——它由客户内容"确认"按钮按需触发（一天可能 0 次也可能 N 次），设计上就不该
  // 排班。回执写 cron_run_logs 只是复用这套"有独立历史、健康检查看得见"的落点（spec
  // docs/specs/2026-09-09-creatomate-connector-spec-v1.md §4.4），job_name 恒为
  // 'creatomate-render'，具体是哪条渲染由 summary.source_record_id 区分，不是按周期对账。
  'creatomate-render': '按需事件触发（内容确认时），非周期任务，不适用 CRON_REGISTRY 的排班对账',

  // 马良 · 出片自检（src/lib/inngest/functions/maliang-render-check.ts）跟在上面那条渲染
  // 之后：每有一条 Creatomate 成片落库就发一次事件，一天 0 到 N 次，不排班。回执
  // job_name 恒为 'maliang-render-check'，哪条片由 summary.source_record_id 区分。
  'maliang-render-check': '按需事件触发（Creatomate 成片落库后），非周期任务，不适用 CRON_REGISTRY 的排班对账',
  // 李白 · 文案溯源（src/lib/inngest/functions/libai-copy-provenance.ts）同理：由
  // content-factory/generate 每写一条候选就发一次事件，一天 0 到 N 次，不排班。回执
  // job_name 恒为 'libai-copy-provenance'，哪条文案由 summary.source_record_id 区分。
  'libai-copy-provenance': '按需事件触发（每篇文案生成后），非周期任务，不适用 CRON_REGISTRY 的排班对账',

  // Reel 批量渲染工作流（src/lib/inngest/functions/reel-batch-render.ts）：由事件 reel/batch.render.started 触发，
  // 再等 reel/batch.preview.approved（PM 审批小样，最长等 48 小时），一次 0 到 N 轮，不是周期任务，不排班。
  // 回执 job_name 恒为 'reel-batch-render'。生产库实测（2026-10-21）：近 48 小时 0 行，最近一次是 2026-09-22。
  'reel-batch-render': '按需事件触发（reel/batch.render.started，等 PM 审批小样），非周期任务，不适用 CRON_REGISTRY 的排班对账',

  // cts-seo-optimizer 于 2026-09-20 退役（PM 拍板）：render.yaml 那条定时任务已删，
  // 换成 Inngest 原生的 cloud-seo-meta-cycle-fanout（同目录 seo-meta-cycle 的对账测试
  // 管它）。路由文件已在 2026-09-29（PR #2200）改成「被调用就返回 410 并记失败」，不再是回滚备用入口，
  // 也不要再把它当回滚路径：9-28 就是这样被带回来的。本条不该再被排班。
  'cts-seo-optimizer': '2026-09-20 退役，换成 Inngest cloud-seo-meta-cycle-fanout；路由 2026-09-29 起固定返回 410，不是回滚入口',

  // 2026-10-07 PM 拍板暂停：没人读的空跑。render.yaml 那段已整块注释掉，
  // 登记行也同步注释掉 —— 留着会天天误报「没跑」。恢复三件套见 render.yaml 对应注释。
  'execution-auto-run': '2026-10-07 PM 决定暂停（没人读的空跑）；仓库里 render.yaml 与登记行已注释（2026-10-21 核）；服务器上是否真停以 Render 读回为准，见台账卡 2026-10-21-render-orphan-cron-services-9；恢复条件见 render.yaml 注释',

  // 2026-10-07 PM 拍板暂停：开关没开的空转。render.yaml 那段已整块注释掉，
  // 登记行也同步注释掉 —— 留着会天天误报「没跑」。恢复三件套见 render.yaml 对应注释。
  'job-boards-weekly': '2026-10-07 PM 决定暂停（开关没开的空转）；仓库里 render.yaml 与登记行已注释（2026-10-21 核）；服务器上是否真停以 Render 读回为准，见台账卡 2026-10-21-render-orphan-cron-services-9；恢复条件见 render.yaml 注释',

  // 2026-10-07 PM 拍板暂停：上游已停 6 周的空跑。render.yaml 那段已整块注释掉，
  // 登记行也同步注释掉 —— 留着会天天误报「没跑」。恢复三件套见 render.yaml 对应注释。
  'team-memory-sweeper': '2026-10-07 PM 决定暂停（上游已停 6 周的空跑）；仓库里 render.yaml 与登记行已注释（2026-10-21 核）；服务器上是否真停以 Render 读回为准，见台账卡 2026-10-21-render-orphan-cron-services-9；恢复条件见 render.yaml 注释',

  // Render 上这条从 2026-10-24 审计起已是暂停、30 天没有运行。不进 dispatcher。
  // 路由留着给人手补跑。恢复时要重新加登记、加进 DISPATCH_CATALOG，并在 Render 打开它。
  'oztop-seo-optimizer': '2026-10-24 审计时 Render 上已暂停且 30 天无运行，不进 dispatcher',
}
