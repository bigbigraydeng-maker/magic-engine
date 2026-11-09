# G2 第 3 组审计：站点体检 / AI 可见度 / 竞品快照 / 基准域名（只读，未改仓库）

数据来源：logs14.json（14 天 cron_run_logs，截止 2026-10-06）；只读生产库 SELECT（2026-10-07 查）；代码在工作副本 nifty-sanderson-f7ce97。

### site-audit-cron （每天 02:00 UTC，路由 site-audit-jobs）
- 写入：清理 `site_audit_jobs` 里 30 天前完成的记录（删）；把卡住 >2h 的 in_progress 记录标 failed；把 pending >1h 的记录重新启动（src/app/api/cron/site-audit-jobs/route.ts:83/114/143；render.yaml:85-96）。不花外部钱。
- a) 最近运行：2026-10-06 02:01 completed；14 天 14 次全 completed、0 次 failed。processed 合计 4（只有 9-30 和 10-06 各清理了 2 条）。注意日志里 failed_count 每天是 3 然后 1——那是「库里还留着的旧失败记录条数」，不是今天又坏了（route.ts:114-123 只统计 + console.log，没有任何告警/待办下发）。
- b) 读取方：它维护的 `site_audit_jobs` 本身由 JobRunner（src/lib/site-audit/job-runner.ts:62-240）读写，被 site-audit-weekly 的「已有任务在跑就跳过」闸（site-audit-weekly/route.ts:84 getInProgressJob）读取；另有 dashboard SiteAuditPanel.tsx 展示。
- c) 读取方在跑吗：site-audit-weekly 在跑（见下，14 天 2 次 completed，库里 jobs 每周都有记录）。
- d) 改变过决定吗：有证据。库里 oztop 2026-09-20 01:01 的体检任务卡死（in_progress），2026-09-21 02:01 被这个任务标成 failed（error_message=「Watchdog: in_progress > 2h (crawl process died)」），否则会一直挡住 oztop 下一周的体检；9-27 oztop 体检恢复 completed。
- 结论：A（小而有用的看门狗）；每天花费：约 0（只是几次库读写 + Render 一次 curl，没法精确到分）；建议：保留。可顺手改：failed_jobs_found 目前只写日志，若要有人看见失败体检，应下发待办（非本次审计范围）。

### site-audit-weekly （每周日 01:00 UTC）
- 写入：给 active 且 `seo_config.weekly_blog=true` 的客户（现为 CTS Tours NZ、oztop 共 2 个）建 `site_audit_jobs` 并后台爬站，结果 upsert 进 `client_site_pages`（route.ts:60-66、88-110；job-executor）。外部副作用：Jina 抓页（匿名额度，是否配 JINA_API_KEY 没法从库里看）+ 每页一次 gpt-4o-mini 分类（classifier.ts:70，最多喂 3000 字符）。
- a) 最近运行：2026-10-04 01:01 completed，processed 2；14 天 2 次全 completed。库里 site_audit_jobs：CTS 10-04 01:01→01:20 completed、oztop 10-04 01:01→01:27 completed；CTS 最新页面 crawled_at=10-04 01:17，oztop=10-04 01:25。
- b) 读取方（逐个 grep 的真实调用点）：
  1. SEO 巡检 seo-patrol-daily：src/lib/seo-patrol/job.ts:231-238 调 buildPageSignals（page-signals.ts:101 读 client_site_pages）喂 R2「缺内链」规则；src/lib/seo-patrol/index-check.ts:92 读它做「收录抽检」；
  2. 周博客 blog-weekly：src/lib/blog/weekly-blog.ts:33/246（pages-context.ts:47 内链上下文）、blog/content-gate.ts:142（防写重复内容）；
  3. seo-weekly-list：src/lib/seo-weekly-list/run.ts:314/375；
  4. strategy/analyzer.ts:23、GEO 页面台账 geo-module/pipeline.ts、dashboard 站点体检页 /api/clients/[id]/site-audit/*。
- c) 读取方在跑吗：seo-patrol-daily 14 天 9 completed + 1 running（最近 10-06 04:01）；blog-weekly 3 次 completed（最近 10-06）；seo-weekly-list 1 次 completed（10-05）。有真实产出：10-05 那次 seo-patrol-daily 的回执 summary 里 index_check = {checked:40, clients:2, not_indexed:9}，即巡检真的在读爬站台账。
- d) 改变过决定吗：有间接证据——seo_patrol_findings 最近 164 条里 not_indexed 136 条、stale_content 28 条（均 status=fresh，来自依赖 client_site_pages 的收录检查与过期内容判断）。但 R2「缺内链」规则（专门吃这次爬站的链接图）最近 164 条里 0 条触发，没法证明 R2 这条线改变过决定。
- 结论：A；每天花费：估约 US$0.01/天（gpt-4o-mini：约 330 页/周 × 约 1000 token ≈ US$0.08/周，是估算，缺实际 token 账；Jina 匿名额度不计费，若配了 key 则没法估）+ 每周 20–30 分钟 Render 算力；建议：保留。

### industry-ai-visibility-daily （每天 16:30 UTC，路由 ai-visibility-weekly；名字 daily、路由叫 weekly 是历史遗留，代码注释自己承认 route.ts:3-9）
- 写入：对 78 个行业问句 × 3 个平台（ChatGPT / Google AI Overview / Google SERP）每天写 234 行进 `industry_ai_visibility_snapshots`（共 15802 行，最早 2026-06-03），运行记录写 `industry_ai_visibility_runs`（orchestrator.ts:266、314）。花外部钱（OpenAI + DataForSEO/SERP）。Inngest 的 ai-visibility-weekly.ts 与它无关（见下一小节）。
- a) 最近运行：2026-10-05 16:31 completed；14 天 13 completed + 1 个「running」（9-28 那条，库里 industry_ai_visibility_runs 显示被清扫器标成 failed、0 题，即那天没收集到；9-21 同样 failed、0 题）。**日志里 processed 14 天全 0 是日志写错，不是没干活**：route.ts:68-69 读 `summary.total/succeeded`，而 orchestrator 返回的字段叫 questions_attempted/questions_ok（types.ts:104-114、orchestrator.ts:327-336），所以永远写 0。真实数据看 industry_ai_visibility_runs：除 9-21、9-28 两天整批失败外，每天 78 题、写 234 行，10-05 total_cost_usd=0.2296，status=partial（见 orchestrator.ts:304-306，有题部分平台失败就是 partial；9-22 当天 47 题失败）。
- b) 读取方：
  1. src/lib/strategy/auto-fetch.ts:656/687（`ai_visibility_score` 目标的当前值自动取数）← goal-current-value-refresh 定时任务(src/app/api/cron/goal-current-value-refresh/route.ts:20)、/api/goals/[goalId]/fetch-current-value、ads-strategy/portfolio/goal-context.ts:6；
  2. 管理页 /dashboard/industry-baselines 的「AI 可见度」标签页（AiVisibilityPanel.tsx:424 → /api/baselines/ai-snapshots）；
  3. 其余引用都在写入方自己（orchestrator）和 snapshot-conclusive.ts 判定工具里。没有别的定时任务/Kernel/日报邮件读它（flywheel/huatuo/zhuge 目录 grep 0 命中）。
- c) 读取方在跑吗：goal-current-value-refresh 在跑（14 天 12 completed），但它读这张表的前提是有 active 的 ai_visibility_score 目标——生产库 goals 表里 primary_metric_key=ai_visibility_score 的只有 2 条，状态是 expired 和 archived，**0 条在用**，所以没有任何目标在真读它。管理页是人工打开才读，没有访问记录可查。
- d) 改变过决定吗：无证据。
- 结论：C（实际无人读；唯一接线是 ai_visibility_score 目标，目前一条在用的都没有；管理页是否有人看没法证明，保守按 C，如 PM 确认常看管理页则降为 B）；每天花费：约 US$0.21/天（industry_ai_visibility_runs.total_cost_usd 近 14 天 0.156–0.230，约 US$6.5/月，这是库里已有的成本记录，可能不含 Render 算力）+ Render 每天占用 10–20 分钟；建议：停（或降到每周一次），同时若保留请修 route.ts:68-69 的日志字段，否则监控永远看到「processed 0」。

### ai-tracker-weekly （每周日 18:00 UTC = 周一 06:00 NZ，旧 Render 路径）
- 写入：对每个 active 且有 enabled 问句的客户跑 runTracker，写 `ai_visibility_runs`（逐问逐引擎）和 `ai_visibility_snapshots`（每客户每周一条）（orchestrator.ts:310/389/455/500）。花外部钱（多引擎问答）。
- a) 最近运行：2026-10-04 18:01 completed，processed 8（8 个客户），耗时约 2.5 小时（8,993,594ms）；14 天 2 次全 completed。cron_run_logs.summary 里 total_cost_usd：10-04=8.62，9-27=8.60，9-20=5.42。
- b) 读取方（逐个 grep）：
  1. PM 每日待办的「AI 追踪全部失败」提醒：src/lib/pm-todo/ai-tracker-failure-items.ts:341（读 ai_visibility_runs），由 pm-todo/manual-items.ts:24 调用；
  2. 周博客选题：src/lib/blog/topic-selector.ts:86、blog/page-seo-intelligence.ts:115/126；
  3. GEO：src/lib/geo/composer.ts:139、flywheel/adapters/GeoComposerAdapter.ts:84；
  4. 月报：lib/monthly-report/collectors/ai-tracker.ts:19、reports/monthly-aggregator.ts:178/255；
  5. 诊断/处方：strategy/analyzer.ts:68、diagnostic/collectors/ai-visibility-collector.ts:47、api/diagnostic/*；
  6. 客户 dashboard 页 src/app/dashboard/page.tsx:166。
- c) 读取方在跑吗：pm-daily-todo 14 天 10 次 completed（最近 10-05）；blog-weekly 3 次 completed（最近 10-06）；库里 ai_visibility_snapshots 最新 week_of=2026-09-28（对应 10-04 这次运行，周按 UTC 周起算），涵盖 CTS(93 次探测)、NAL(54)、Roman(30)、oztop(10)、East International(12) 等客户，有真实产出。
- d) 改变过决定吗：有证据。事件：2026-09-20 East International 24/24 探测失败（Google 报错、OpenAI 额度用光）而当时「看上去跟健康客户一样」，这就是 ai-tracker-failure-items.ts 文件头（行 3-8）和 ai-tracker-weekly/route.ts:107-123 的修复由来，现在 100% 失败会进每日待办邮件。blog 选题读 client_brand_rank 弱项（topic-selector.ts:86-100）也是直接影响选题。
- 结论：A；每天花费：约 US$1.23/天（US$8.6/周 ÷ 7，来自 cron_run_logs.summary，约 US$37/月）；建议：保留。留意：单次耗时 2.5 小时、串行执行，而旧文件头注释自己写了「10-15 分钟」，现已 10 倍于设计，且 Render maxDuration=900 秒（route.ts:36 注释）——是 fire-and-forget 所以没被杀，但 8 个客户之外再加客户会更长。

### ai-visibility-tracker-weekly （Inngest，每周一 06:00 NZ，上面 ai-tracker-weekly 的「新路径」；Inngest 函数 src/lib/inngest/functions/ai-visibility-weekly.ts）
- 写入：派单函数只查名单、给开了 `seo_config.ai_visibility_inngest_enabled=true` 的 active 客户发事件，干活函数调 runTracker 写同样两张表（ai-visibility-weekly.ts 文件头 1-30；名单筛选 src/lib/ai-tracker/weekly-fanout.ts:108）。
- a) 最近运行：10-04 17:01 completed，9-27 completed，14 天 2 次全 completed，**processed 全 0**，summary 只有 {week_key}。
- b) 读取方：它写的表与 ai-tracker-weekly 同一批（上一节），但它本身**一行都没写**：生产库里 10 个 active 客户的 seo_config 没有任何一个有 ai_visibility_inngest_enabled（我逐个打印了 seo_config 里含 inngest/ai_vis 的键，全空）。旧路径 ai-tracker-weekly/route.ts:93-98 的排除条件因此对谁都不生效，8 个客户全由旧路径处理。
- c) 读取方在跑吗：同上（读取方在跑，但这条没给它们任何数据）。
- d) 改变过决定吗：无（零产出）。
- 结论：C（空转的灰度壳：定时在跑、不干活；Inngest 看起来「健康」但等于没有）；每天花费：约 0（派单不调任何服务）；建议：若迁移计划还要继续，写一条开关计划（哪天给哪个客户开）；若不再推进，可停并删掉，避免「processed 0」让人误以为是 AI 追踪全空。注意日历：这条函数已被 registry 登记（src/lib/cron/registry.ts:340）。

### competitor-watch-weekly （Inngest，每周一 05:45 NZ；src/lib/inngest/functions/competitor-watch-weekly.ts）
- 写入：派单给 `seo_config.competitor_watch_enabled=true` 的 active 客户（src/lib/competitors/watch.ts:70），干活函数调 takeCompetitorSnapshot 打 DataForSEO Labs 逐竞品域名拉关键词，写一行 `competitor_snapshots`（src/lib/competitors/snapshot.ts:87）。
- a) 最近运行：10-04 16:45 completed，9-27 completed，14 天 2 次全 completed，processed 全 0（summary 只有 week_key）。
- b) 读取方：`competitor_snapshots` 全仓只有一处读——src/app/api/clients/[id]/production/[packageId]/route.ts:129（生产包详情按 production_package_id 过滤，周快照不带 package id）。别无其它读取（grep 全 src 仅此一处）。
- c) 读取方在跑吗：该接口是页面按需请求，没法证明有人看；更关键：**没有任何客户开了开关**。注释写「PM 2026-09-20 拍板『开』，先只给 CTS」（文件头第 1 行），但生产库 CTS 的 seo_config 里只有 weekly_blog/meta_cycle_*，没有 competitor_watch_enabled；competitor_snapshots 表里最新一行是 2026-06-11（CTS 和 oztop 各 1 行，还是更早手动产的），之后一行都没新增。
- d) 改变过决定吗：无证据。
- 结论：C（拍了板没开：开关没打开，所以什么都没跑；表里也没人消费周快照）；每天花费：目前约 0；开了之后：每周每客户一次 DataForSEO Labs，19 个竞品域名 × 1 次调用（watch/snapshot 代码注释），单价没法估，缺 DataForSEO 账单；建议：改——要么真给 CTS 打开 `seo_config.competitor_watch_enabled` 并接上一个真正的读取方（现在表没有读取方），要么停掉。「决定开了但没开」本身值得 PM 知道。

### baseline-domains-monthly （实际每周，名字叫 monthly 是历史；两处调度）
- 写入：对 43 个 baseline_domains 重新采集 SEO 分，写回 `baseline_domains.seo_score/last_collected_at`、插 `baseline_domain_score_history`、按行业汇总 upsert `industry_benchmarks`（只写 seo 维度的 p50/p75/p90，3 个行业）、写 `baseline_cron_runs`（route.ts 顶部流程 + 215-255）。花 DataForSEO 的钱（已关掉占 75% 成本的 SERP 调用 skipSerp）。
- a) 最近运行：10-01 17:01 completed，processed 43；9-24 同样 43；14 天 2 次 completed。baseline_cron_runs 近 8 条：8-23/8-30/9-09/9-16/9-24/10-01 completed（43/43），**9-07 和 9-08 两次 failed（0/43）**，之后恢复。baseline_domains 最新 last_collected_at=2026-10-01 17:05。
- 两处调度是否重复触发：是，两个调度器都在敲同一个接口，但现在不会重复花钱：
  1. Render 后台手工建的 cron（不在 render.yaml，登记在 src/lib/cron/registry.ts:287，每天 17:00 UTC 敲一次）；
  2. GitHub Actions `.github/workflows/baseline-domains-monthly.yml`（每月 1 号 03:00 UTC，`0 3 1 * *`，docs/STATE.md:158 也列了）。`gh run list` 显示它 7/1 失败，8/1、9/1、10/1 都 success，每次只跑 7–9 秒——即返回 HTTP 200 的「被节流跳过」，因为接口有 7 天节流闸（route.ts:316 MIN_DAYS_BETWEEN_RUNS=7、327 weeklyThrottleCheck、380 调用）。风险点：节流只看「上一次 completed/partial 距今 ≥7 天」，如果哪个 1 号凑巧离上次正好 >7 天，GitHub 这次会真跑一遍并把 Render 的当周顺延；并且 weeklyThrottleCheck 读库出错时选择「不跑」（route.ts:337-341），不会双花钱。
- b) 读取方：
  1. 华佗处方 src/lib/huatuo/benchmarks.ts:64（SEO 基准优先实时从 baseline_domains 算）← huatuo/agent.ts:165/376 ← /api/clients/[id]/prescription/generate（route.ts:406）与 /diagnostic/baseline；
  2. web-intelligence 竞品名单 src/lib/web-intelligence/targets.ts:26-32、competition-sources.ts:20-25（用同行业非客户域名补竞品清单），被 Inngest web-intelligence 每天 06:00 NZ 的 cron（src/lib/inngest/functions/web-intelligence.ts:42）和 traffic-direction 接口使用；
  3. 管理页 /dashboard/industry-baselines；/api/baselines/*。
  `industry_benchmarks` 里 seo 维度这 3 行（tourism_operator/real_estate_agency/building_supplies，source='P30.0 baseline cron'）updated_at 仍是 2026-05-13，尽管每次回执写 benchmarks_written=3：表没有自动更新时间，没法凭 updated_at 证明新值落库（值可能相同）。huatuo 的 SEO 基准本来就绕过这张表、实时读 baseline_domains（benchmarks.ts:56-97），所以这三行基本是死数据，只对非 SEO 维度的回退有意义。
- c) 读取方在跑吗：prescriptions 表近期有产出（最近 10-06 08:02、9-29、9-01，8 月起共 12 条）；但每条的 benchmarks_used 字段都是 null。cron_run_logs 里没有 web-intelligence 的运行记录（Inngest 自己的页面没法在此验证），market-intel-daily 与它不是同一个。
- d) 改变过决定吗：无证据（prescriptions.benchmarks_used 全 null，没法证明基准数字出现在某条处方里；web-intelligence 读名单是否实际改变监控对象也无记录）。
- 结论：B（有读取方，没法证明改变了决定；其中 industry_benchmarks 的 3 行属死数据）；每天花费：约 US$0.43/天（代码注释 route.ts:344-346 自己估「每月约 US$13」，是作者估算非账单）；建议：改——保留每周这一次，**停掉 GitHub 那条每月 1 号的重复调度**（只会在不凑巧时双跑，平时纯噪音），并让 huatuo 把 benchmarks_used 填上以便以后能验证。

## 汇总

| 任务 | 结论 | 每天花费 | 建议 |
|---|---|---|---|
| site-audit-cron | A | 约 0 | 保留（失败体检只写日志，可补待办） |
| site-audit-weekly | A | 约 US$0.01（估算）+ Render 算力 | 保留 |
| industry-ai-visibility-daily | C | 约 US$0.21（库内成本记录） | 停或降到每周；修 processed 日志字段 |
| ai-tracker-weekly | A | 约 US$1.23（cron_run_logs 成本） | 保留；留意耗时 2.5h |
| ai-visibility-tracker-weekly（Inngest） | C | 约 0 | 空转壳：定开关计划或停 |
| competitor-watch-weekly（Inngest） | C | 约 0（开了才花） | 改：真开 CTS 并接读取方，否则停 |
| baseline-domains-monthly | B | 约 US$0.43（代码注释估算） | 改：停 GitHub 重复调度；保留 Render 每周一次 |
