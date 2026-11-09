# 审计 G2 第二部分：SEO 标题循环 + 谷歌逐页数据（只读，未改仓库）

数据来源：logs14.json（2026-09-22 至 2026-10-06 16:15 UTC）、生产库只读 SELECT、仓库代码（工作副本 nifty-sanderson-f7ce97）。
共同事实：这 5 组任务**全部是 Inngest 定时/事件函数，不在 render.yaml**，也不在 cron_list.tsv（render.yaml:884-891 注释写明 CTS 老 Render 任务已退役，由 Inngest 接替）。它们的 Inngest 登记在 src/lib/cron/registry.ts:309 / :326-328 / :368。
Inngest 没有 Render 算力费；费用只算外部接口和模型。

---

### seo-meta-cycle-trigger 路由（手动入口，不定时）
- 写入：不写任何表。非 dry_run 只是发 Inngest 事件 `seo/meta-cycle.due`（src/app/api/cron/seo-meta-cycle-trigger/route.ts:140-148）；dry_run 只读演练（:60-72）。路由头注释（:10-18、:30-34）明说「不在 render.yaml、不该排、不写 cron_run_logs」。
- a) 最近运行：cron_run_logs 里没有这个名字，设计如此（不写记录），所以「logs 里没行」不代表坏了。无法从日志证明最近一次手动触发是哪天。
- b) 读取方：无（它是入口不是数据）。它调用 `buildAdapterForClient`（src/lib/inngest/functions/seo-meta-cycle.ts:114）和 `runDryRunCycle`（runner.ts:551 起）。
- c) 读取方在跑吗：不适用。
- d) 改变过决定吗：无证据。生产库 seo_meta_log 里 9-19（周六 15:29 UTC，不是周一定时点）那批 5 条 PR 改动是手动触发出来的（step1-6 的 W38 回执 started_at=2026-09-19T15:29-15:34，不在周一 05:30 档），推断是这个入口或等价手动事件，但没有直接记录证明。
- 结论：C（没有定时、没有日志、不花钱的手动工具）；每天花费：0；建议：保留（回滚/补跑用，不用管）。

---

### seo-meta-cycle-step1 … step6 （Inngest cron `30 5 * * 1` 每周一 05:30 UTC，仅 1 个客户）
总体：周一 fan-out（cloud-seo-meta-cycle-fanout，src/lib/inngest/functions/seo-meta-cycle.ts:78-104）→ 对「seo_config.meta_cycle_enabled=true」的客户发事件 → run-one 跑六步（:129-203）。生产库查到启用客户只有 1 个：CTS Tours NZ（clients 表 seo_config->>meta_cycle_enabled=true 仅此一行）。Oztop（d5c9）的改动是 8-17 到 9-21 的 wp_plugin 通道，旧 oztop-seo-optimizer 路由写的，不是这条链。
logs14 里每步 2 行（W40=9-28、W41=10-05，各 completed）；W38=9-19 手动跑、W39=9-21 因 cycled_recently 跳过，在 14 天窗口外或属早退，下面用生产库补全。
**这 6 个 job_name 是同一次运行的 6 张回执，不是 6 个独立任务**：成本和结论共用一份，下面分步给数据。

写入（整条链）：seo_meta_log（step4 里写，runner.ts:473）、GitHub 客户网站仓库 chinatravel 的 PR（**对外副作用**，客户网站标题/描述）、flywheel_actions（action_type=meta_cycle_manual_review，生产库见 2026-10-05 05:32:57 一行）、人工待办。

**step1-check-due**（logs14：2 行 completed，processed 合计 0）
- 做什么：对改满 14 天的页做 CTR 前后对比，写 seo_meta_log.outcome（runner.ts runStep1CheckDue）。
- 证据：三周回执 summary 全是 checked=0；W41 回执写明 `legacy_ctr_check: off_rank_shadow_period`（seo-meta-cycle.ts:137-141）。生产库 seo_meta_log 中 `outcome IS NOT NULL` 的行数 = 0。
- b) 读取方：weekly-report/build.ts:233-240（读本周 checked_at 的 outcome 放进周报）；runner.ts:118-130（regressed 时转人工）。c) weekly-seo-report 在跑（logs14：2 次 completed，最近 10-04 18:31 UTC）。d) 无证据（没有任何一行 outcome 被写过，周报这一栏是空的）。
- 结论：B（读取方在跑，但这一步目前整条是空转：关掉了，3 周全 0）；每天花费：0（不调外部接口，只读 GSC 快照表）；建议：改——要么在影子期结束后接回 CTR 检查，要么把这一步的回执并掉，别让「checked=0」每周看着像正常。

**step2-candidates-ready**（processed 合计 18 = 2 周×9）
- 做什么：从快照里挑候选页（runStep2CandidatesReady），每周都是 9 个候选（W38/W40/W41 回执 candidate_count 全是 9）。
- b) 读取方：同一次运行里的 step3（seo-meta-cycle.ts:154）。c) 在跑。d) 有：W40 的 9 个候选里 3 个过闸、W41 只过 1 个，说明它的输出被 step3 消费。注意三周候选数恒为 9，像是固定清单而不是随数据变化——无证据证明候选在变。
- 结论：A（链内输入，被下一步真消费）；每天花费：0（读库）；建议：保留。

**step3-prescribed（过闸/事实核对）**（processed 合计 14）
- 外部副作用：实时 GSC 页面搜索词（免费）、DataForSEO 搜索量/难度/实时 SERP（付费，gate.ts:103-104、:357-366）、命中后 Claude Haiku 事实核对。
- 证据（回执 summary）：W40 passed=3，拦下 2 条：forbidden-city-travel-guide（slug 不在可编辑数据文件，「skipped before any DataForSEO/GSC spend」）、china-tours（SERP 显示是别的自家页在排，会自相残杀）；W41 passed=1，拦下 liziba-station-chongqing（关键词 90 天内已被另一页用过）、forbidden-city（同上）、china-tours（clients.seo_config.meta_cycle_protected_slugs 受保护页）。
- b) 读取方：step4。c) 在跑。d) 有：2026-09-28 与 10-05 各有具体拦截例子（上面）。
- 结论：A；每天花费：估算 < $0.01/天（每周最多 9 个候选，每个至多约 1-3 次 DataForSEO 调用，单价 serp 注释 ~$0.005/次，labs.ts/serp.ts；仓库里没有这条链的现成花费记录，所以只是估算）；建议：保留。

**step4-applied**（processed 合计 4；applied 数：W38=2、W40=1、W41=0）
- 写入：开 GitHub PR（例：W40 的 chinatravel PR #214 beijing-to-xian-high-speed-train，W38 的 #199、#200）并写 seo_meta_log、生成新标题用 claude-haiku-4-5（src/lib/seo-meta/cycle/ai-meta.ts:51）。
- b) 读取方：weekly-report/build.ts:226-232（周报「本周自动改了几页」）、api/clients/[id]/seo-meta-log/route.ts:33（页面）、pm-todo/manual-items.ts:447、seo-weekly-list/run.ts:304,391（避免对刚改过的页重复出建议）、step3 的 90 天复用闸 gate.ts:386。c) 周报与待办在跑（weekly-seo-report 10-04 completed；pm-todo 在 manual-items 中读）。d) 有：2026-10-05 周报与 seo-weekly-list 用 seo_meta_log 判定「近 30 天已改过」（run.ts:391-392）。
- 注意事实：生产库里 CTS 的 15 条 seo_meta_log 中 **8 条带 reverted_at（已回退）**：9-19 那批 5 条全部回退，9-28 那批 4 条中 3 条回退（只有 beijing-to-xian 留着）。9-27 的 6 条未回退。W41（10-05）这周 0 条自动应用、1 条转人工。
- 结论：A；每天花费：Haiku 每页约几美分以内，估算 < $0.01/天（无现成记录）；建议：保留，但要盯回退率（见最后「值得注意」）。

**step5-logged**（processed 合计 1）
- 回执内容就是 step4 里 applied.length 的复述（seo-meta-cycle.ts:178-184：summary={logged_rows: step4.applied.length}）。真正的日志行在 step4 内写。
- b) 读取方：无（grep job_name `seo-meta-cycle-step5-logged` 除 receipts.ts 常量与写入点外没有读取）。
- 结论：C（纯重复回执）；每天花费：0；建议：停（并入 step4 回执），属可选清理。

**step6-completed**（processed 合计 2）
- b) 读取方：`recentlyCycled`（roster.ts，跳过 7 天内跑过的客户，生产库 9-21 一行 early_exit=skipped, reason=cycled_recently 证明它被真读）；CRON_REGISTRY（registry.ts:326-328，健康检查按它判定这条链醒没醒）。c) 在跑。d) 有：9-21（周日 05:31）因它跳过了一次重复运行；这是防重复开 PR 的闸。
- 结论：A；每天花费：0；建议：保留。

整条链的汇总：每周 1 次、1 个客户；a) 最近成功运行 2026-10-05 05:33 UTC，logs14 内 2 周全 completed、无 failed。

---

### seo-meta-rank-sampler （Inngest cron `20 20 * * *`，每天 20:20 UTC）
- 写入：seo_meta_log 的 rank_samples / rank_verdict / verdict_detail（rank-sampler.ts:172，只在改满 18 天、有基线排名的行上做）；每行 1 次 DataForSEO SERP（付费）。
- a) 最近运行：logs14 仅 2 行（10-04、10-05，均 completed，processed=0，duration ≈14-16s）。它 2026-10-04 才上线（registry.ts:329 addedAt）。
- 为什么 0：loadDueRows 要求 `baseline_rank_status IS NOT NULL`（rank-sampler.ts:90-96）。生产库里 `baseline_rank_status IS NOT NULL` 的行数 = 0（旧改动都早于 10-04 加列，10-05 又 0 条新改动）。回执 summary 实际为 rows_dispatched=0。
- b) 读取方：weekly-report/build.ts:233-240 与 :416-456（周报里展示 rank_verdict 行）。c) 周报在跑，但目前没有任何行有 rank_verdict。d) 无证据（还没产生过一条结论）。
- 最早首次有实料：下一次有新改动并写入基线后 +18 天。以 10-05 为 0 条新改动算，最早约 2026-10-12 的周一改动 → 10-30 左右才第一次真采样。
- 结论：B（读取方有、在跑，但还没有任何东西可读，没改变任何决定）；每天花费：现在 $0（0 行 0 次调用）；将来上限 = 当天到期行数 × 单次 SERP（约 $0.005），封顶每天 30 行（MAX_ROWS_PER_RUN=30，rank-sampler.ts:40）≈ $0.15/天最坏；建议：保留（影子期设计，注意首次真采样时间）。

---

### seo-post-publish-monitor （事件触发，**不是定时任务**）
- 写入：每个检查点 1 行 cron_run_logs（job_name='seo-post-publish-monitor'，src/lib/seo/post-publish-monitor-store.ts:47-48 upsert）；无其他表。读页面 HTTP、读 gsc_performance_snapshots/ga4_traffic_snapshots（store.ts:21-22）。
- 触发方式：事件 `seo/page-watch.started`，只由手动脚本 scripts/seo/dispatch-post-publish-watch.mjs 按 config/clients/cts/post-publish-watch.json 发（launched_at=2026-09-17，14 页）。全仓库没有任何定时器或别的函数发这个事件。
- a) 最近运行：logs14 14 行全部 started_at=2026-09-23T12:00:00（= T+7 天检查点，processed=1 各自），生产库共 28 行 = 14 页 × 2 个检查点（9-19 的 T+72h 14 行 + 9-23 的 T+168h 14 行）。结果 9-23：healthy/hold 8、insufficient_data/wait_for_data 6，原因 `page_absent_from_latest_snapshots`。
- 判断：**不是停了，是一次性批次按设计做完了**（两个检查点都已出）。没有被谁取代：它的存储函数 readPageMetrics 被 seo-meta-cycle 的 runner 当库复用（src/lib/seo-meta/cycle/runner.ts:29），但事件函数本身没有新批次。
- b) 读取方：grep job_name `seo-post-publish-monitor` 在 src 里只有写入点；无 API/页面/周报/日报读取这 28 行。仅有的「读」是 cron_run_logs 的通用统计。
- c) 不适用。d) 无证据（没有任何决定引用这些回执；CTS 页面变动后来走 gsc_page_daily + 台账卡）。
- 结论：C；每天花费：0（无新批次；每次检查只 1 次 HTTP + 2 次读库）；建议：保留代码待下次发布新页时再发事件；若不再用，可停并移除脚本（不急）。

---

### flywheel-seo-weekly （Inngest cron，每周日 16:15 UTC = 周一 05:15 NZ，CTS + Oztop 两个客户）
- 写入：flywheel_metrics 4 行/客户/周（seo.domain.organic_keywords、organic_traffic、authority_score，source='semrush'；加 seo.content.published_posts，source='blog_posts'；src/lib/flywheel/adapters/SeoContentAdapter.ts:99-157）。外部调用：DataForSEO 的 domain_rank_overview + backlinks/summary 共 2 次/客户（seo-weekly.ts:49 PROVIDER_CALLS_PER_CLIENT=2；labs-rankings.ts:103-119）。⚠ 来源标签写的是 `semrush`，实际是 DataForSEO（labs-rankings.ts:103 注释「Replaces SEMrush」），名字过时。
- a) 最近运行：logs14 6 行（派单 1 + 2 个客户单 ×2 周：9-27、10-04），全部 completed；processed 合计 8（fanout 2+2，单客户 1×4）。生产库 10-04 CTS 与 Oztop 各 metrics_written=4。
- b) 读取方（grep 4 个指标键逐个核）：
  1) /dashboard/clients/[id]/seo-intelligence 页（page.tsx:1039 取 api/clients/[id]/seo-intelligence/metrics/route.ts:68-71，页面 :1223-1226 展示「收录关键词/估算流量/权威分/已发布博客」；organic_keywords 还用于 :1381 韦恩图计算）。
  2) 增长归因 attribution-cron：blog-weekly（src/lib/blog/weekly-blog.ts:316）与 api/clients/[id]/blog/route.ts:271 建的 flywheel_actions 以 seo.domain.organic_traffic 为 expected_metric，由 attribution/job.ts 读 flywheel_metrics 前后值写 flywheel_outcomes。
  3) 不读：health-score（只含 seo.gsc.* / seo.ga4.*，health/score.ts:61-64）、Spotlight 指标（metric-catalog.ts:180-188 不含这 4 个键）、anomaly 规则（rules.ts 只有 seo.gsc.avg_position/clicks 等）。
- c) 读取方在跑吗：attribution-cron 在跑（logs14：56 次，52 completed + 4 running，最近 10-06 12:01）；seo-intelligence 页面有没有被人打开无记录（无证据）。
- d) 改变过决定吗：**没有，且有反证**。生产库 flywheel_outcomes 中 metric_key=seo.domain.organic_traffic 共 11 条，**全部 verdict=inconclusive、confidence=0**（非 inconclusive 的行数=0）。另外数字本身不可信：CTS 估算流量=29，而同期 GSC 近 28 天点击=1042（goals 表 seo_gsc_clicks_28d 当前值 1042）；这指标跟 CTS 实际流量相差 30 倍以上，页面上显示给 PM 会误导。
- 结论：B（读取方真在跑，但归因全是「无结论」，页面只展示不驱动动作，且数字与 GSC 对不上）；每天花费：估算 < $0.01/天（每周 2 客户 × 2 次 DataForSEO 调用 ≈ 4 次/周；仓库没有该调用的现成成本记录，单价按 DataForSEO 公开价量级估，**未核实**）；建议：改——先把页面和归因的主指标换成 GSC 点击（seo.gsc.* 已在 flywheel_metrics），这个任务再决定停；至少先把 source 标签从 semrush 改成真实来源。
- 另：/api/cron/flywheel-seo-weekly 路由只是手动补触发（route.ts:3-20），不写 cron_run_logs，不是第二个定时任务。

---

### gsc-page-daily （Inngest cron，每天 18:30 UTC，派单者）与 gsc-page-daily-pull（Inngest 事件，干活者）
**二者关系（弄清）**：同一条链的两半。`gsc-page-daily` = 每天一次的「派单」函数（cloud-gsc-page-daily-fanout），只读名单和回执、不调 Google、发 `gsc/page-daily.pull.due` 事件；`gsc-page-daily-pull` = 每张订单一个函数（cloud-gsc-page-daily-pull），真去调 Google Search Console 并写表。证据：src/lib/inngest/functions/gsc-page-daily.ts:3-13、:236-262。
**100 与 10 的数字对账**：gsc-page-daily 10 行（9-26 至 10-05 每天 1 行）的 processed 是「派出去的订单数」（counts_are=dispatched_not_pulled，:134-141）：9-26 到 9-30 每天 16 单（含按月补历史的 backfill），10-01 起每天 4 单（4 个客户的 daily）= 16×5+4×5 = 100。gsc-page-daily-pull 有 100 行，每行 processed=1，合计 100 = 每张订单一行。两边相等，没有重复也没有丢单。（20 行/10-01 之后的 pull，平均 ≈27 秒/单，每天合计 ≈107 秒；9-26 起的 100 行平均 149 秒，因为有历史补数。）
- 写入：gsc_page_daily（每客户每页每天的 clicks/impressions/position）与 gsc_page_fetch_receipts（每张订单的回执），只读 Google，no_publish。
- a) 最近运行：两个任务都是 14 天内无一次 failed（10 + 100 全 completed）。生产库最新一张回执 2026-10-05 18:32 UTC，status=complete，data_through_day=2026-10-03；gsc_page_daily 各客户最新 day=2026-10-03（谷歌数据本身滞后约 2 天，不是没拉）。拉取客户 4 个：CTS（历史最早 2026-02-26）、Oztop（最早 2025-07-08）、Roman HU、Magic Engine（自己）。
- b) 读取方（grep 过表名，去掉测试/迁移/类型）：
  1) src/lib/seo-weekly-list/run.ts:354,363,575（每周一 04:30 UTC 的 seo-weekly-list 生成/复核待办，只对有 seo_gsc_clicks_28d 目标的客户）；
  2) src/lib/strategy/auto-fetch.ts:201-259（metric seo_gsc_clicks_28d 的目标「当前值」自动取数，被 goal-current-value-refresh、goals/[id]/fetch-current-value、goal-context 三处调用）；
  3) seo-weekly-list/candidates.ts:4,199（同上链路的汇总函数）。
  其余（src/types/strategy.ts:418 只是说明文字、url/page-key.ts 是键规则）不读数据。
- c) 读取方在跑吗：
  - seo-weekly-list：logs14 只 1 行（10-05 04:31，completed，processed=1，8.6 秒；cron 每周一一次，14 天窗口里 10-05 是唯一一次）。summary 里 inserted=5。
  - goal-current-value-refresh：每天 17:30 UTC，logs14 有 14 行 completed（10-05 processed=3）。生产库 goals 里唯一的 seo_gsc_clicks_28d 目标（CTS，id 56449b71…）current_value=1042，updated_at=2026-10-05 17:31，与 gsc_page_daily 取数时点吻合。
- d) 改变过决定吗：**有，三个证据**：
  1) 2026-10-05 04:31 seo-weekly-list 用 gsc_page_daily 28 天窗口生成 5 条待办写进 execution_items（生产库查到 5 条 steps_json.loop=seo_goal_v1，全部 status=pending，创建时间 10-05 04:31），其中两条是「点击率偏低」页（liziba-station-chongqing、chongqing-travel-guide），这种判断只有逐页点击/曝光才能做（run.ts 的 ctr 候选逻辑，candidates.ts）。**目前这 5 条还没人处理（截至查询时 pending）**，所以「生成」是有效的，「被采纳」无证据。
  2) 台账 docs/ledger/2026-10-06-cts-protected-pages-meta-refresh.md：PM 批准改 CTS 三个页的标题，改动前 28 天基线（签证指南 63 点击/5,405 曝光…）取自 gsc_page_daily，并把 10/20、11/3 的复核定为再看 gsc_page_daily——数据已被用于一次真实决定与后续验收。
  3) seo_gsc_clicks_28d 目标的 current_value=1042 来自它，用来给目标做进度/判定（auto-fetch.ts:24,172-259；缺天/过期时拒绝出数）。
  不足：4 个客户的数据都在拉，但上述读取方只覆盖 **CTS 一个客户**（生产库 active 目标里只有 CTS 有 seo_gsc_clicks_28d 目标）；Oztop、Roman HU、Magic Engine 的 gsc_page_daily 目前没有读取方（搜 src 无其他引用）。
- 结论：gsc-page-daily（派单）A；gsc-page-daily-pull（干活）A；每天花费：Google Search Console API 免费，Inngest 无算力费；每天约 4 次 GSC 拉取共 ≈107 秒函数时间（10-01 起），没有付费接口，即 $0；建议：保留；但可考虑只对「有 SEO 目标的客户」拉，其余 3 个客户数据暂时没读取方（不影响成本，可暂不动）。

---

## 汇总表

| 任务 | 结论 | 每天花费 | 建议 |
|---|---|---|---|
| seo-meta-cycle-trigger（手动路由） | C | 0 | 保留（手动补跑工具，无需管） |
| seo-meta-cycle-step1-check-due | B | 0 | 改：CTR 检查关着，每周 checked=0，影子期后接回或并掉 |
| seo-meta-cycle-step2-candidates-ready | A | 0 | 保留（但候选数三周恒为 9，需留意是否固定清单） |
| seo-meta-cycle-step3-prescribed | A | 估算 <$0.01（DataForSEO，无现成记录） | 保留 |
| seo-meta-cycle-step4-applied | A | 估算 <$0.01（Haiku，无现成记录） | 保留；盯回退率（15 条 8 条已回退） |
| seo-meta-cycle-step5-logged | C | 0 | 停（并入 step4 回执，可选清理） |
| seo-meta-cycle-step6-completed | A | 0 | 保留（防重复闸 + 健康检查依据） |
| seo-meta-rank-sampler | B | 现在 $0；将来最坏 $0.15/天（30 行×$0.005） | 保留；首次真采样最早约 10-30 |
| seo-post-publish-monitor | C | 0 | 保留代码，一次性批次已做完（9-19/9-23），不再有新批次 |
| flywheel-seo-weekly | B | 估算 <$0.01（DataForSEO，未核实单价） | 改：数字与 GSC 差 30 倍、归因 11 条全是 inconclusive；标签 semrush 实为 DataForSEO |
| gsc-page-daily（派单） | A | $0 | 保留 |
| gsc-page-daily-pull（干活） | A | $0（GSC 免费） | 保留；Oztop/Roman/自己 3 个客户的数据暂无读取方 |

A 6 / B 4 / C 3 / D 0（含 step1-6 拆开计数，共 12 条）。

## 最值得注意的发现
1. flywheel-seo-weekly 写的「估算流量」CTS=29，GSC 实际 28 天点击=1042；它的归因输出 11 条全是 inconclusive/confidence 0；seo-intelligence 页面却把它当「估算流量」展示。
2. seo-meta-cycle 在 CTS 官网上自动改过的 15 条标题里 8 条已被回退（9-19 批 5/5、9-28 批 3/4）；而「改完对不对」的两道验收（T+14 CTR 检查 outcome、T+18 排名采样 rank_verdict）到现在一条结论都没产出（outcome/baseline_rank_status 非空行数均为 0）。
3. gsc_page_daily 不是「只写不读」：seo-weekly-list 已用它生成 5 条待办（10-05，仍 pending），目标取数和 PM 的 10/6 改标题基线也用了它；但只服务 CTS 一个客户，另 3 个客户的数据暂无读取方。
4. seo-post-publish-monitor 不是被停了：是一次性手动批次（14 页×2 个检查点）按设计做完，logs 最后一次 9-23 是正常终点，没有东西「取代」它。
5. 本审计未建日历提醒（任务要求只读，且不确定是否需要）。若需要跟进：seo-meta-rank-sampler 首次真采样最早约 2026-10-30、台账里 CTS 三页标题复核 10/20 与 11/3 已有台账卡。
