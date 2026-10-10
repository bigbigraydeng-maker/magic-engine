# G4 组审计：分析/处方/记忆/监控类定时任务（15 个 Render/GitHub + 14 个 Inngest 定时函数）

取证时间：2026-10-06 16:30 UTC（台账 logs14.json 截止 2026-10-06 约 16:15 UTC；生产库查询为只读 GET）。
说明：Inngest 后台运行记录这边查不到（没有可用的只读入口），Inngest 函数一律用「它写的表的最新行时间 / 它自己写进 cron_run_logs 的回执」作证据；有两个函数（heartbeat、web-intelligence）两样都没有，已单独标明。
所有 file:line 指本工作副本 `/Users/raydeng/Projects/magic-engine/.claude/worktrees/nifty-sanderson-f7ce97`。

---

# 第一部分：render.yaml / GitHub 定时任务（15 个）

### zhuge-weekly-recalculate （每周一 03:00 UTC，路由 zhuge-recalculate）
- 写入：`zhuge_sessions`（整份输出）、`flywheel_actions`（建议，4 个飞轮维度）、`execution_items`（看板卡，source=zhuge）、`client_decision_history`（action-persister.ts:137,238；src/app/api/cron/zhuge-recalculate/route.ts）。每个客户调一次 Claude。
- a) 最近运行：9-28 completed（8 个客户，7 成 1 败，166 秒）；**10-05 03:01 那条至今停在 `running`**（zhuge_sessions 里 10-05 只有 03:01~03:02 四个客户，之后没了——进程中途被打断，剩下的客户这周没刷新）。14 天：1 完成 + 1 卡死。9-28 的 processed 合计 8、10-05 为 0（没收尾）。
- b) 读取方：①`/api/clients/[id]/zhuge/latest-actions` 读 zhuge_sessions（src/app/api/clients/[id]/zhuge/latest-actions/route.ts:105）→ 客户页「ZhugePriorityWidget」；②`execution_items` 被执行看板页读；③`flywheel_actions` 被归因任务读（flywheel_outcomes）；④`client_decision_history` 被 memory-extractor 回填、被 loadMemoryForClient 读。
- c) 读取方在跑吗：归因/看板在跑。但**这条每周定时链本身不读记忆**：`assembleZhugeInput`（src/lib/zhuge/assembler.ts）没有任何 memoryContext，types.ts:179 该字段是可选的，只有手动的 `/zhuge/conduct` 路由才注入（conduct/route.ts:93）。
- d) 改变过决定吗：看板上 zhuge 来源的卡：全史 1019 张，885 张被后续周「顶替」(superseded)，66 张待办；**最后一张被标「完成」是 2026-06-24**（60 张完成全在 6 月）；9 月以来只有 1 张 in_progress（East International，9-29）、2 张 skipped（CTS，10-04 09:13 同一秒，像是批量清扫不像人点）。其 flywheel_actions（9 月起 484 条）是「只建议没执行」的行，被 execution-evidence.ts:1-42 专门排除出学习，不会进记忆。无证据说明哪一周的建议被照着做了。
- 结论：B；每天花费：约 US$0.02（每客户一次 Claude 调用，zhuge_sessions.output.cost_usd 实测 0.021~0.024，每周 4~8 个客户 ≈ $0.1~0.2/周）+ 每周约 3 分钟 Render 算力；建议：**改**——先修「中途被打断后没收尾」（行不收口、剩余客户不跑），再决定要不要继续每周烧；另外它把 Magic Lab / Magic Lab Class 两个内部账号也算进去了（10-05 的 4 条里有 2 条是内部账号，白花约 $0.045）。

### diagnostic-weekly （每周一 08:00 UTC）
- 写入：`diagnostic_runs`、`diagnostic_findings`（runner.ts:45,264）；每个客户跑 6 个采集器（DataForSEO 关键词/外链/SERP/竞品、Apify 广告库+社媒+点评抓取、Google Places、AI 可见度实时探测）+ Claude 综合。
- a) 最近运行：10-05 completed（7 个客户跑了，3 个内部账号因没填行业被跳过，用时 1350 秒≈22.5 分钟）；9-28 completed（6 个跑，CTS 因冷却跳过，1035 秒）。14 天 2/2 成功，processed 合计 13、failed 0。**9-21 那条停在 `running`**（库里 9-21 的 6 个 diagnostic_runs 其实都 completed，说明工作做完了、只是日志没收口）。
- b) 读取方：客户门户页 diagnosis/report（src/app/portal/[clientId]/diagnosis/page.tsx:44,54；report/page.tsx:52,70）；zhuge assembler（assembler.ts:62,76）；prescription-weekly（auto-prescribe.ts:285）；今日待办 `pushDiagnosticItems`（manual-strategy-items.ts:93）→ 走「周报」车道（five-kinds.ts:`diagnostic_findings: 'weekly'`）→ weekly-seo-report（路由第 60 行过滤 `laneOf==='weekly'`）；luban/review agent 等。
- c) 读取方在跑吗：weekly-seo-report 10-04、9-27、9-20 三个周日均 `sent:true`；prescription-weekly 每周跑。
- d) 改变过决定吗：9 月以来共 119 条 finding（30 critical / 47 high）；但真正从体检走到「方案→看板动作」的只有 CTS（见 prescription-weekly）。其他 6 个客户的体检只落到门户页和周报里一行「本周体检查出 N 个严重…」。无证据说明某次体检结果改变了某个具体动作。
- 结论：B；每天花费：没法估（缺每家采集器逐次用量；`datasource_usage_logs` 2026-08 起就没有任何行，等于账没记）。已知体量：每周 7 客户 × 6 采集器、22 分钟；建议：**改**——先把内部账号 / 没有进行中目标的客户排除出采集（它们既没有方案也没有目标，采集结果只落一行周报），能省大部分外部接口钱；同时修收口。

### prescription-weekly （每周二 08:00 UTC）
- 写入：`prescriptions`（自动批准落地）、Initiative、`execution_items`（source=diagnostic）（auto-prescribe.ts:307-504）；每份方案一次 Claude。
- a) 最近运行：10-06 completed（considered 7，只开出 1 份；54 秒）；9-29 completed（1 份、1 个客户报错 "Colon expected at position 2439"=New Asian Logistics 的 AI 回复 JSON 解析失败，102 秒）；9-22、9-15 各 0 份（2 秒）。14 天 2/2 completed（9-29 里含 1 个 error），processed 合计 14、真开出 2 份。
- b) 读取方：看板页/execution API（execution/route.ts:230,666）；今日待办 `pushPrescriptionItems`（manual-strategy-items.ts:159）→ 周报；execution-auto-run 的白名单挑选（auto-run.ts:200）；门户 prescription 页；luban agent。
- c) 读取方在跑吗：周报在发；execution-auto-run 在跑但只是空跑（见下）。
- d) 改变过决定吗：**只对 CTS 起作用**：8 月起共 12 份方案，全部是 prescription-weekly 自动出的，没有一份人工方案；每周 7 个客户里 5~6 个因「这个客户没有进行中的目标」被跳过（10-06、9-29、9-22、9-15 四周的回执原文）。原因：Oztop 的 3 个目标 9-02~9-05 到期、NAL 的目标 9-30 到期（goals-expiry-check 在 10-01 标成 expired），没人续目标，处方就停。例子：10-06 只给 CTS 开了方，派生 3 个 Initiative。
- 结论：B；每天花费：约 1 次 Claude/周（CTS），没法精确（该路径没写 cost）；建议：**保留**，但要 PM 知道它实际只服务 CTS；要想覆盖其他客户需先给他们定目标（那是业务决定，不是修代码）。另外 NAL 那次 JSON 解析错误值得查（9-29，唯一一次 error）。

### benchmark-accumulator （每周一 07:40 UTC）
- 写入：目标是 `industry_benchmarks` 的 growth_* 增长字段（benchmark-accumulator.ts:351-374）。
- a) 最近运行：9-28、10-05 **2/2 failed**，processed 0、failed_count 4：`Could not find the 'growth_client_count' column of 'industry_benchmarks'`。已用生产库验证：`industry_benchmarks.growth_client_count` 返回 42703（列不存在）。仓库里迁移文件 `supabase/migrations/20260728000001_industry_benchmarks_growth_provenance.sql` 早就写好，文件头写明「只能 PM 手工 apply」，**没人 apply**（2026-07-28 起至今 10 周）。
- b) 读取方：华佗 `fetchBenchmarks`（huatuo/benchmarks.ts:134，取整行 select *）→ `formatBenchmarksForPrompt` 进开方提示词（prompts.ts:385,485）与诊断基线页（api/clients/[id]/diagnostic/baseline/route.ts:69）；baseline-domains-monthly 另一条路径写别的字段（route.ts:234）。
- c) 读取方在跑吗：华佗/开方在跑，但**读到的增长字段永远是外部研究种子值**（样本行 realistic_3mo_growth_pct=10，来源 Sprout Social），ME 自有数据一条没进去。
- d) 改变过决定吗：无证据——写入从未成功过一次。
- 结论：D；每天花费：≈0（4 秒、DB 写入全失败）；建议：**要么让 PM 一键 apply 那份迁移，要么停掉**。提醒：真 apply 后它会拿 1~2 个客户的结果写成「行业基准」（accumulator 只要 MIN_SAMPLE_THRESHOLD=3 个样本就写，不要求 3 个客户；华佗提示词里有「⚠️小样本」兜底，但仍会进开方提示词），上线前要决定样本阈值是否改成按客户数。

### execution-auto-run （每天 09:30 UTC，挂着 ?dry_run=1）
- 写入：只写 cron_run_logs.summary（verdicts）；dry_run 下不生成任何草稿（auto-run 路由第 62~75 行）。
- a) 最近运行：14/14 completed，每次 1 秒、processed=1、generated=0。**每天挑中的是同一个候选**（CTS 的 generate_blog_post，id c3f889d3…）：10-05 判「可以自己做」，10-06 判「属于被换掉的旧方案，blocked」。render.yaml:638-657 的注释说「现在挂着 dry_run=1，名单对了再分两步放开」——2026-08-06 起挂到现在两个月没放开。
- b) 读取方：**没有**。grep `execution-auto-run` 除注册表（cron/registry.ts:144）和 docs/STATE.md:146 外无任何引用；今日待办的 `pushAutoRunItems` 是**自己重新调用选择函数现算**（manual-items.ts:787-800 注释「判定复用 cron 自己的选择函数」），不读这个 cron 写的 verdicts。
- c) 读取方在跑吗：无读取方。
- d) 改变过决定吗：无证据（0 次生成，14 天 0 个草稿）。
- 结论：C；每天花费：≈0（1 秒 DB 读，无 AI）；建议：**停**（空跑名单没人看、已重复 14 天；要不要真跑是 PM 的业务决定——回「放开」即改一行去掉 ?dry_run=1）。

### anomaly-detector-daily （每天 05:00 UTC）
- 写入：`anomaly_signals`、`flywheel_actions`（payload.source=proactive_signal）、`execution_items`（zhuge/proactive.ts:302-362）。第二步每次有信号就调 Claude Haiku。
- a) 最近运行：14/14 completed，每次约 18 秒，扫 9~10 个客户。processed 合计 136（扫描客户数，不是信号数）。
- b) 读取方：`/api/clients/[id]/intelligence/insights`、`/narrative`、`/health-score`、`/anomaly-signals`（以上 4 个路由读 anomaly_signals）→ 客户页 IntelligenceSummarySection / NarrativeBlock / AnomalySignalPanel；归因 execution-evidence.ts 识别 proactive_signal。
- c) 读取方在跑吗：页面读，无访问记录可查（没有 page view 日志）。
- d) 改变过决定吗：14 天里（9-22~10-06）共产出 25 条信号，19 条被 Claude 直接「驳回」(dismissed)，6 条「处理」(processed)；6 条全是**同一个**「CTS GEO 提及率 -16.7%」信号（9-21~9-27 每天重新触发一条新的 flywheel_action，分别叫 investigate / recovery / recovery_audit 等不同名字），9-28 起全部 dismissed。看板上 source=proactive_signal 的卡 9 月以来只有工厂发 reel 回执 3 张，**没有一张来自异常检测**。无证据说明某次信号改变了动作。
- 结论：B；每天花费：Claude Haiku 约 US$0.0014/天（15 天合计 $0.0205，来自回执 step2.total_cost_usd）+ 18 秒 Render 算力；建议：**保留但降噪**——同一个信号别连发 7 天；成本极低，主要问题是产出没人行动。

### daily-cron-digest （每天 06:00 UTC）
- 写入：发一封邮件给 hello@magicengine.cloud（Resend）；无表。
- a) 最近运行：14/14 completed，每次约 1.3 秒；**15 天每天都发了**，每封 64~80 个失败任务、收成 7~13 个不同问题（回执 summary.failed_jobs / distinct_problems）。
- b) 读取方：PM 收件箱；cron_run_logs 本身还被后台「自动任务健康」页（api/admin/cron-health）、今日待办 cron_failing/cron_stuck 类条目读。
- c) 读取方在跑吗：邮件每天送出；cron-health 页有。
- d) 改变过决定吗：有——代码历史：2026-09-06「日报不再显示自相矛盾的 0 failed」（107be0c04）、2026-09-23「让 AI 账户断电/任务卡死/长期故障当天就有人知道」（4f47eaba5）；route.ts 注释记录「2026-09-22 那封邮件 80 行，prospecting-sweep 一家 25 行」→ 触发了降噪重写。但 9-24 到 10-06 的问题数一直在 7~13 之间，说明大半是长期不修的老问题。
- 结论：A；每天花费：≈ 1 封邮件 + 1 秒；建议：**保留**（它是整个监控的最后一道出口）。

### proposal-view-digest （每天 19:00 UTC）
- 写入：邮件给 hello@magicengine.cloud（Resend）；读 `website_lead_events`(source=proposal_tracking)。
- a) 最近运行：14 天 10 completed、**4 failed，错误全是 `[object Object]`**（9-23、9-25、9-28、10-02）。其余 10 次 completed 全是 `quiet_day`（昨天没人看方案）。
- 真相：4 次失败 = 4 次**真的有人打开了方案**的日子。生产库 `website_lead_events` 近两周只有 5 条 proposal_tracking 事件，全是 `carrington_estate` 这一份方案，落在 9-23、9-24、9-27、10-02，正好对上 4 次失败（9-24 的访问落在 9-25 19:01 那一轮）。也就是说：**有活的 4 次，4 次邮件都没送出去**。
- 原因（代码证据，未能在 Resend 后台核实）：发信人写死 `'Magic Engine Monitor <onboarding@resend.dev>'`（route.ts:`from:` 行）。src/lib/email/sender.ts:1-15 的文件头正是记录这个沙盒发信人对非账号主人地址返回 403、「2026-07-24 事故」，别的通知都改成 `meMailFrom()` 了，这个文件漏改。另外 `String(sendError)` 把错误对象变成 `[object Object]`，所以日志里看不到真原因。
- b) 读取方：PM 收件箱（唯一）；c) 在跑：邮件根本没发出去；d) 无。
- 结论：D；每天花费：≈0；建议：**改**——发信人换 `meMailFrom()`、错误转成字符串（两行小改）。**这 4 次的访客读取情况 PM 已经错过了**（Carrington Estate 方案被打开 5 次），可以去库里补看。

### agent-learning-rollup （每周一 07:00 UTC，POST）
- 写入：`client_learned_preferences`（每客户每周 1 行摘要，learning-rollup.ts:`savePreference`）。无 AI。
- a) 最近运行：10-05、9-28 都 completed，但 failed_count 5/4（每个有信号的客户都失败）；表里 `extracted_from_table='learning_rollup_weekly'` 的行数 **= 0**（生产库实查）。连续 11 周（W30~W40）`preferences_inserted` 都是 0。
- 根因（生产库验证）：rollup 把去重键 `"2026-W40::<client-uuid>"` 写进 `extracted_from_id`，而该列是 UUID 类型（迁移 20260610000001 第 26 行）；用同样的值去查，生产库返回 `22P02 invalid input syntax for type uuid`。所以每次插入必然失败，函数返回 null，被计成 error。W35 及以前显示 0 失败，是因为另一个窗口 bug（按 computed_at 切周）让它根本没数据，回执里「全 0」曾经看起来正常（learning-rollup.ts:263-271 注释）。
- b) 读取方：`loadMemoryForClient` → `formatMemoryForPrompt`（prescription/generate、/refine、/zhuge/conduct、/zhangqian/discover、luban agent）——都是手动触发路径；**每周自动的诊断/处方/诸葛亮链不读记忆**（见 zhuge、prescription-weekly 条）。
- c) 在跑吗：读取方有，但从未读到过这类行。d) 无（零行）。
- 结论：D；每天花费：≈0（6 秒 DB）；建议：**改**——把去重键换成合法写法（比如改列类型或换去重列）才能写进去；或者干脆停（它承诺的「弥补 memory-extractor 看不到负面信号」从未生效过，且 zhuge_feedback_events 全表只有 3 行、都是 6-03）。

### memory-extractor （每天 06:30 UTC，POST）
- 写入：`client_proven_patterns`（162 行）、`client_failed_experiments`（130）、`client_learned_preferences`（31，含 1 行 5 月的手工 FDE 批注）、回填 `client_decision_history.outcome_verdict`。无 AI。
- a) 最近运行：14/14 completed，每次约 21 秒，processed 6~7；回执里每天 `outcomes_stale_skipped: 49`（49 条证据太旧被挡）、deactivated 空。
- b) 读取方：同上 loadMemoryForClient 的手动路径；`/api/clients/[id]/memory/list|export`；conductor.ts:177-183（仅手动 conduct）。
- c) 在跑吗：手动路径在用与否无日志；自动链不读。
- d) 改变过决定吗：无证据。9 月新增 145 条 patterns / 120 条失败实验，主要集中在 9-28 一天（23 条）；10 月至今只新增 2 + 2 + 1。
- 结论：B；每天花费：≈0（无 AI；21 秒 Render 算力）；建议：**保留但要让自动链读到它**——否则这套学习只在人手点按钮时才起作用；或降频到每周。

### team-memory-sweeper （每 30 分钟）
- 写入：补提炼 `work_sessions`→`team_lessons`/`team_skills`；撤下被推翻的教训、下架连败套路。
- a) 最近运行：9-22 以来 705 次，**705 次全是 0 干活**（回执 distilled=0、retired=0、cost_usd=0），每次约 2.3 秒；全部 completed。
- 上游已死：`work_sessions` 最新一行创建于 **2026-08-22**（此后 6 周没有任何新会话进来）；`team_skill_runs` 全表 0 行；56 个会话永远停在 active。上游是本机 `scripts/team-memory/session-start.mjs / session-end.mjs`（经 /api/team-memory/ingest/context 调用），但当前 `~/.claude/settings.json` 的 hooks 只有 window-discipline 与 self-check，**没有任何 team-memory 钩子**，项目 `.claude/settings.local.json` 里也没有。
- b) 读取方：`/api/team-memory/context`（给本机开窗钩子用）、`/dashboard/team-memory` 页（page.tsx:65-79）；207 条 team_lessons 全是 8-17 以前生成的。
- c) 在跑吗：钩子没装 → 实际读取方 = 只有那个页面，无访问记录。
- d) 无证据（9 个 skills、0 次执行记录、教训没有使用计数列）。
- 结论：D；每天花费：48 次/天 × 约 5 次数据库请求 ≈ 240 次/天 + 2.3 秒 Render 算力，占 cron_run_logs 写入量约 8%（参考 docs/audits/supabase-request-audit.md 第 66-77 行：cron_run_logs 记账本身占 PostgREST 调用 31.6%、零产出的空跑被点名）；Claude 费 0；建议：**停**，除非 PM 要把钩子重新装上（那是个业务决定）。

### pm-daily-todo （周日~周四 19:00 UTC = NZ 周一~周五早上）
- 写入：一封邮件给 hello@magicengine.cloud（Resend），无表。
- a) 最近运行：10/10 completed（10-05 最近一次），每次 10~30 秒，`sent:true`。回执 total_items：9-20 156 → 9-24 166 → **9-27 30**（9-26 PM 拍板「只留五类」后）→ 之后 35、40、43、51、**81（10-04）、98（10-05）**。
- b) 读取方：PM 收件箱；背后 `loadManualItems`（pm-todo/manual-items.ts）是 daily-todo、weekly-seo-report 共用的发现引擎。
- c) 读取方在跑：邮件每次送出。
- d) 改变过决定吗：有——五类拍板（pm-todo/five-kinds.ts 文件头）原文写「2026-09-25 那封邮件标题 166 件，真要 PM 管的大约 10 件」；该邮件直接催生了 9-26 的车道重构。另需注意：事项数 30→98 在 8 天内又涨回去。
- 结论：A；每天花费：1 封邮件 + 约 12~30 秒；建议：**保留**；看一眼 10-04 起事项数涨回 81/98 是不是又有一类事项在刷屏。

### product-map-sync-daily （每天 18:15 UTC）
- 写入：product_map_* 同步表（GitHub PR/Issue 快照）；`summariesGenerated`=0，不调 AI。
- a) 最近运行：14/14 completed，30~50 秒，processed 16（2 PR + 14 issue）；每天 `unclassifiedSeen` 138~158（未分类工作，数字每天几乎不变）。
- b) 读取方：只有 `/dashboard/me2/product-map` 页（page.tsx:`loadProductMapConsole`，只读）；deploy-health-items.ts 只引了它的一个常量，不读数据。
- c) 读取方在跑吗：页面是否有人看没有访问日志，无法证明。
- d) 无证据。
- 结论：C；每天花费：约 40 秒 Render 算力 + 一批 GitHub API 调用，AI 费 0；建议：**停或降到每周**（直到 PM 说明它是有人要看的页面）。

### cron-run-logs-cleanup （每天 16:50 UTC）
- 写入：调用 DB 函数 `cron_run_logs_purge` 清理旧记录。
- a) 最近运行：14/14 completed，3 秒，每天清 145 行；`remaining` 10-05=43,298（10-04=42,866，**一天净增 ~430**），最老一条 2026-07-07。
- b) 读取方：它维护的表被 cron-health 页、daily-cron-digest、各 pm-todo 巡检读。
- c) 在跑：是。d) 它存在的理由（注释：原触发器死锁会让记录写不进去）成立。
- 结论：A；每天花费：约 3 秒；建议：**保留**。但表仍在每天净增 430 行（只清「7 天以上、完成、空产出」的，每天只能清 145），上面这类 0 产出任务（team-memory-sweeper 每天 48 行等）停掉后能直接减量。

### goals-expiry-check （GitHub 工作流，计划 03:30 UTC，实际 GitHub 常延迟到 09~10 UTC）
- 写入：`goals.status` active→expired（verdict.ts:166-180）。
- a) 最近运行：GitHub 端 `gh run list` 14 次全部 `success`（9-23~10-06，event=schedule）；cron_run_logs 里只有 9 条（9-27 failed `column goals.recurrence does not exist`，9-29~10-06 连续 8 次 completed）。**GitHub 成功但库里没有对应记录的有 9-23~9-26 与 9-28**——记录没写还是没写成，查不出。9-27 那条 failed 是含 recurrence 列的未合主干分支代码（feat/goal-monthly-rollover 等）打到生产库造成的，主干代码里没有这个字段。processed 合计 1（10-01 标了 1 个目标过期）。
- b) 读取方：目标页 VerdictPanel/历史页（goal/[goalId]/_components/VerdictPanel.tsx、goals/history/_client.tsx）；**以及 prescription-weekly 的 listActiveGoals（过期后「没有进行中的目标」→ 该客户的方案被跳过）**。
- c) 读取方在跑：是。
- d) 改变过决定吗：有——NAL 的「每月 300 个开聊」目标 9-30 到期、10-01 被它标成 expired，10-06 的 prescription-weekly 就写 `NAL: 这个客户没有进行中的目标，方案无从挂起`；而 9-29 那周 NAL 还在被开方。同样 Oztop 的 4 个目标 9-02~9-05 过期后，Oztop 每周都被跳过。目前生产库只剩 3 个 active 目标，全是 CTS。
- 结论：A；每天花费：GitHub Actions 约 10 秒 + 0.5 秒 DB；建议：**保留**；但它揭露了一个业务问题：除 CTS 外所有客户都没有进行中的目标，导致处方周更对它们全部空转（待 PM 决定给谁续目标，而不是工程问题）。

---

# 第二部分：Inngest 里带 cron 的函数（14 个，不在 render.yaml）

全部登记在 `src/lib/inngest/functions/index.ts` 的 `cloudFunctions`，由 `/api/inngest`（src/app/api/inngest/route.ts）对外服务。注意：新增函数需要有人去 Inngest 后台 Sync 一次才生效（flywheel-seo-weekly.ts 头注）。能在 cron_run_logs 看到回执的就算「真跑」。

### conversation-health-heartbeat （每 6 小时 `0 */6 * * *`，函数 cloud-conversation-health-heartbeat）
- 写什么：`conversation_health_alerts`（不健康就 upsert，健康就删；自愈表）。**不写 cron_run_logs，也没有登记进 CRON_REGISTRY**（registry.ts grep 无 heartbeat），所以健康检查看不到它跑没跑。
- 谁读：今日待办 `pushConversationHealthAlertItems`（pm-todo/manual-items.ts:690）。
- 最近有没有真跑：**查不到，且有疑点**。生产库 `conversation_health_alerts` 当前 0 行。我用函数自己的规则（health-heartbeat.ts:250-256，24 小时入站消息数 < 过去 29 天日均就报 webhook_silent）对生产消息表重算：CTS email（近 24h 5 条 < 日均 9.72）、CTS messenger（13 < 15.21）、NAL messenger（0 < 7.38）三个渠道都应该是「不健康」，表却是空的——要么它没在跑（Inngest 没 Sync/函数被停），要么我重算的窗口与它有差异。无法在 Inngest 后台确认。
- 改变过决定吗：无证据（表一直空）。
- 结论：D（疑似没在跑，待在 Inngest 后台核实）；每天花费：没法估（缺 Inngest 运行记录；每次要分页读 30 天消息，4 次/天）；建议：**先去 Inngest 后台看它有没有运行记录**；有则说明规则太松/表被误清，无则 Sync。

### conversion-daily-pipeline （每天 06:00 NZ）
- 写什么：`me_sale_outcomes`（同步 CTS 表格 / NAL 私信里的咨询、AI 自动审核、补发被授权失效拦下的回传）；**外部副作用：通过 AI 审核的线索会回传 Meta CAPI**。
- 谁读：今日待办 conversion_needs_review（decide 车道）；广告平台（CAPI）；me_sale_outcomes 审核页。
- 最近运行：cron_run_logs 14/14 completed，每次约 6.5~7.7 分钟（41 个 CTS 块 + 8 个 NAL 块），processed 合计 86。
- 谁在读/用：9-12 起 696 条 lead 记录：501 条 AI 自动驳回、73 条 AI 自动通过、56 条规则驳回（cts-qualify-rule）、其余 PM 手工；10-05 CTS 表 817 行，新增 lead 1、表格备注排除 9。
- 改变过决定吗：有——73 条 AI 自动审核通过的线索会作为转化回传给 Meta；14 条过期不发送（回执注明「已超过广告平台 7 天窗口」）。
- 结论：A；每天花费：约 7 分钟 Render 算力 + 若干 Claude 审核（每块 5 条；总额没记录，没法估）；建议：**保留**。

### crm-lead-followup-digest （每天 08:00 NZ）
- 写什么：①每天先把 CTS 表格里员工写的跟进记录同步进 `contact_touchpoints`（sheet-followup-sync.ts:221,280，10-05 回执：同步 11 条）；②本该发「客人填了表还没人回」的汇总邮件，**但开关没开**。
- 谁读：①touchpoints 被 CRM 今日页/时间线/待回电提醒读（api/clients/[id]/crm/today/route.ts:158 等）；②邮件收件人固定 hello@magicengine.cloud（PM 2026-09-24 拍板「先只发给自己」）。
- 最近运行：12/12 completed（9-24~10-05），每次 86~363 秒；**12 次回执全是 `enabled:false`、`sent:false`**，CTS 回执原因「未启用（LEAD_FOLLOWUP_DIGEST_ENABLED 不是 true）」，列出但未发 15 条、积压 129 条。Roman HU 同样有 1 条被开关挡住。
- 改变过决定吗：邮件部分从未发送（0/12）；表格备注同步部分有真实写入。
- 结论：D（邮件部分没启用，PM 9-24 说「看两三天准不准」，开关实际一直没打开）；每天花费：约 2~6 分钟 Render 算力 + Google Sheets API 读取；建议：**PM 决定开还是停**：开了就让汇总信起作用，不开则把表格同步拆出来、把这个函数停掉。

### lead-sheet-sync （每小时 :20 NZ）
- 写什么：把 Facebook 线索追加进客户指定的 Google 表格（CTS 留资总表 Sheet1；回执里的路线 cts-fb-lead-sheet）。
- 谁读：客户销售团队看这张表；同一张表被 conversion-daily-pipeline、crm-lead-followup-digest 的表格同步读。
- 最近运行：9-22 以来 298 次（297 completed + 1 failed：HTTP 524）。processed 合计 296。
- **疑点（高优先级，需要有人打开表格核对）**：回执（summary.results[].routes[].appendedLeadIds）里同一批线索被反复「追加」：lead id 2588293634949755 在 297 次运行里出现了 267 次，1348813487134201 出现 217 次，1581146359829636 99 次，1770246237575351 61 次，1157789073717854 30 次——几乎每小时都有同样 5 个 id 被判「表里没有」重新追加，`appended` 每小时恒为 5（每天累计 48→105 条，10-05 共 105）。按代码（sync.ts:213-253）如果判重键没对上，就会每小时往客户表格里写同样的 5 行。但同一时间 CRM 读到的表格总行数只从 797（10-03）涨到 806（10-04）、817（10-05），一天仅 +9~11，与「每天追加 72~105 行」对不上。所以**回执与表格实际行数矛盾**：我无法读客户表格验证，是「回执说重复写、行数说没重复」二选一；若是前者，客户表里已经有几百行重复。
- 改变过决定吗：无证据（该表是销售看的，有没有人用没有日志）。
- 结论：A（有人读且是主链），但带一条必须核实的重复写入疑点；每天花费：24 次 Sheets API 读+追加，Render 算力小；建议：**保留；立刻让人打开 CTS 留资总表核对有没有重复行**（回执用 lead id 2588293634949755 可以直接搜）。

### gsc-page-daily （每天 18:30 UTC，另有每单一个 gsc-page-daily-pull）
- 写什么：`gsc_page_daily`（逐页逐日 Google Search Console 数据）+ `gsc_page_fetch_receipts`。
- 谁读：①`seo-weekly-list`（src/lib/seo-weekly-list/run.ts:354,363,575；每周一 04:31 UTC 跑，10-05 回执 inserted 5 条给 CTS 目标）；②目标自动取数 `fetchSeoGscClicks28d`（strategy/auto-fetch.ts:201,226，CTS 新目标「自然搜索点击增长」10-05 创建）。仅这两处（与线索一致）。
- 最近运行：fan-out 10/10 completed（每天 4 个客户），pull 100/100 completed；`gsc_page_daily` 最新 day = 2026-10-03。
- 改变过决定吗：有——seo-weekly-list 10-05 用它的数据给 CTS 目标排出 5 条「加强页面…」候选（例：china beijing 第 19 名、月搜 3600；点击率偏低页面）。
- 结论：A；每天花费：Google API 免费，约 4 个客户 × 轻量请求，Render 算力小；建议：**保留**。

### flywheel-seo-weekly （每周一 05:15 NZ，函数 fanout + snapshot-one）
- 写什么：`flywheel_metrics`（source='semrush'，实际 DataForSEO；3 个指标 authority_score / organic_traffic / organic_keywords，每客户每周）。
- 谁读：归因任务（attribution/job.ts:299）、健康评分/趋势/洞察 API（api/clients/[id]/health-score|intelligence|…）、dashboard 首页、异常检测规则。
- 最近运行：cron_run_logs 6 条全 completed（W40、W41 两周，CTS + Oztop 各 9 秒，每家 4 个指标写入，回执 provider_calls_max=2）。库里 9-27、10-04 两周各 6 行。
- 改变过决定吗：无——seo.domain.organic_traffic 的 outcome 全表 11 条，**11 条全部 inconclusive**。
- 结论：B；每天花费：每周最多 4 次 DataForSEO 调用（回执写明 max_provider_calls=4；单价没法确认，缺 DataForSEO 账单），折合每天不到 1 次；建议：**保留**（成本极小，且是别的飞轮的底数）。

### competitor-watch-weekly （每周一 05:45 NZ）
- 写什么：本应写 `competitor_snapshots`。
- 最近运行：9-27、10-04 两次 completed，回执只有 week_key，**processed 0（名单为空）**。生产库查询：`clients.seo_config` 里 `competitor_watch_enabled=true` 的客户 **0 个**；`competitor_snapshots` 最新一行是 2026-06-11。registry.ts:316 注释写着「PM 2026-09-20 拍板开，先只给 CTS」，但 CTS 的开关没打开。
- 谁读：无（没数据）；改变决定：无。
- 结论：D（写入方没启用）；每天花费：≈0（Inngest 空派单 30 秒）；建议：**让 CTS 的开关真打开，或停掉**。

### ai-visibility-weekly （每周一 06:00 NZ，函数 fanout + tracker-run-one）
- 写什么：本应写 AI 可见度追踪回执；`seo_config.ai_visibility_inngest_enabled=true` 的客户 **0 个**（生产库实查）。
- 最近运行：9-27、10-04 两次 completed，processed 0（名单空，42~74 秒）。同期旧 Render 链 `ai-tracker-weekly`（10-04）processed 16、全成功——**真正干活的是旧链**，新链是并行未切换。
- 谁读/改变：新链无产出，无读取方。
- 结论：D（没启用）；每天花费：≈0；建议：**不动 / 或留到切换时**。不是 bug，是尚未切换。

### seo-meta-cycle （每周一 05:30 NZ，6 步，fanout + run-one；目前只有 CTS 开了 meta_cycle_enabled）
- 写什么：`seo_meta_log`（65 行，含 Oztop 路径写入的）、往 CTS 网站仓库开 PR（chinatravel#214）。
- 最近运行：cron_run_logs 6 步×2 周全 completed。9-28：候选 9 → 过闸 3 → 自动合 1（PR #214 beijing-to-xian-high-speed-train，我用 gh 核对为 MERGED，9-28 05:32）；10-05：候选 9 → 过闸 1 → 自动改 0，手工路由 1。
- 谁读：`weekly-seo-report`（weekly-report/build.ts:226,234）；gate（seo-meta/cycle/gate.ts:386，90 天关键词不重复闸）；rank-sampler。
- 改变过决定吗：有——闸门在 10-05 拦下 8 个候选（原因含 keyword_reused_by_another_page_90d、slug 不在可编辑文件里、事实核对不符）；9-28 真改了 CTS 一页的标题（PR 已合并）。台账 docs/ledger/2026-10-06-title-cycle-first-full-week-findings.md 也记了「第一周自动改 0、手工 1」，verify_by 10-13。
- 结论：A；每天花费：DataForSEO + GSC 调用只对过闸候选发生（回执：被挡的在花钱前拦下，如 "skipped before any DataForSEO/GSC spend"），Claude 开方每候选一次；总额没记录，没法估；建议：**保留**。

### seo-meta-rank-sampler （每天 20:20 UTC，无时区前缀）
- 写什么：`seo_meta_log` 的 rank_verdict / 排名样本；每行最多一次 SERP 调用，每天最多 30 行（MAX_ROWS_PER_RUN）。
- 最近运行：10-04、10-05 两次 completed，`rows_dispatched: 0`。原因（设计内）：改完标题要等 T+18 天才首次取样（rank-sampler.ts:5-6、:81），65 行里最晚 optimised_at=9-28 → **最早 10-15 才会有活**；rank_verdict 全 65 行都还是 null。
- 谁读：seo-meta 周循环最后一步的 improved/regressed 统计（目前 checked 0）。
- 结论：C（暂：首批 10-15~10-16 才到期，现在零产出；到期日再复查）；每天花费：目前 ≈0；到期后最多 30 次 SERP/天（单价没法确认）；建议：**保留**；10-16 复查它第一次真取样。

### simaqian-reputation-weekly （每周四 09:00 NZ）
- 写什么：回执（cron_run_logs，含 AI 起草的点评回复草稿和帖子草稿，`no_publish:true`）。
- 谁读：今日待办 `simaqian_review_drafts`（pm-todo/simaqian-review-items.ts:20,81，「review」车道）。
- 最近运行：只有 1 条（9-30 20:03 UTC，79 秒）：10 个客户，Oztop 起草 2 条回复（cost $0.002242），Roman HU 起草失败（评价只有星级没有文字），其余 0 条新评价。前一个周四没有记录（该函数 9-24 前后才上线）。
- 改变过决定吗：无证据（没有 PM 是否审批、发布了那 2 条回复的记录）。
- 结论：B；每天花费：约 US$0.0003/天（周 $0.002）；建议：**保留**。

### libai-prompt-library-monthly （每周二 09:00 NZ，函数里只在每月 1~7 号才干活）
- 写什么：回执（cron_run_logs，只报告不改文件）。
- 谁读：今日待办 libai-items（pm-todo/libai-items.ts）：回执 27 天内的才进待办。
- 最近运行：9-28 跳过（不是首周）、10-05 真跑：检查 6 个文件、findings 空。
- 改变过决定吗：无（0 个发现）。
- 结论：B；每天花费：0；建议：**保留**（每月 1 次有效运行，成本为 0）。

### web-intelligence-due （每天 06:00 NZ，函数 cloud-web-intelligence-due）
- 写什么：`web_intelligence_runs`（58 行）、`market_signals`（竞品网站变化信号）、Apify 抓取；只对 `web_intelligence_settings` 里 enabled+entitled 的客户（目前只有 CTS，NZ$499 套餐）跑，竞品只有 `wendywutours.co.nz`。
- 最近运行：Inngest 没写 cron_run_logs；用 `web_intelligence_runs` 作证据：9-08~9-28 几乎每天有运行（共 58 条：45 complete / 12 failed / 1 reconciliation）；**最后一条创建于 9-28 17:02 UTC，状态 `reconciliation`（error_code=capture_start_unknown）；此后 8 天没有任何新运行**。
- 根因（代码证据）：`dueTargets`（lib/inngest/functions/web-intelligence.ts:93-100）规定「上一条不是 complete/failed 就跳过」，而 reconciliation 既不是 complete 也不是 failed，且没有任何代码把它转成终态——这个网址被**永久卡住**，竞品抓取自 9-29 起静默停摆。
- 谁读：`market_signals` 被客户页「tour-landscape」竞品概览与 chat 读（api/clients/[id]/web-intelligence/tour-landscape/route.ts:17、lib/web-intelligence/service.ts:22）；无访问日志。
- 改变过决定吗：无证据。
- 结论：D（读取方在，但写入方已卡死）；每天花费：卡住前约 NZ$0.05/天（9-22~9-28 共 12 条运行 capture_cost US$0.0146 + interpretation US$0.0506，accounted NZ$0.33；单次预留 NZ$0.617 在 reconciliation 行里一直未结算）；建议：**改**——把 reconciliation 当终态处理（或加人工结清入口），否则每个异常都会永久锁住一个网址；这个也不在 CRON_REGISTRY 里，健康检查看不到。

### web-intelligence-traffic-due （每月 1 号 03:00 NZ）
- 写什么：竞品流量方向估算；总闸 `WEB_INTELLIGENCE_TRAFFIC_ENABLED` 默认关（docs/ENV.md:245 写明默认关；函数 web-intelligence.ts:66 不为 'true' 就直接返回 skipped）。
- 最近运行：Inngest 无回执，也无专属写入表可查；Render 环境变量值我这边读不到，**无法证明是开还是关**。
- 结论：C（无证据在产出）；每天花费：关着则 0；建议：核对 Render 环境变量；若确认一直关着，把定时函数停掉省得每月空跑。

---

# 汇总表

| 任务 | 结论 | 每天花费 | 建议 |
|---|---|---|---|
| zhuge-weekly-recalculate | B | ≈$0.02（Claude）+3 分钟/周 | 改（修中断后不收口；排除内部账号） |
| diagnostic-weekly | B | 没法估（采集器用量没记账；22 分钟/周） | 改（先排除没目标/内部客户） |
| prescription-weekly | B | ≈1 次 Claude/周（仅 CTS） | 保留（PM 知道只服务 CTS） |
| benchmark-accumulator | D | ≈0（4 秒，写入全败） | 改（PM 批准迁移）或停 |
| execution-auto-run | C | ≈0 | 停（或 PM 回「放开」） |
| anomaly-detector-daily | B | ≈$0.0014 + 18 秒 | 保留并降噪 |
| daily-cron-digest | A | 1 封邮件 | 保留 |
| proposal-view-digest | D | ≈0 | 改（发信人 + 错误信息，2 行） |
| agent-learning-rollup | D | ≈0 | 改（去重键类型）或停 |
| memory-extractor | B | ≈0（21 秒） | 保留，让自动链读它 |
| team-memory-sweeper | D | ≈240 次 DB 请求/天，0 产出 | 停 |
| pm-daily-todo | A | 1 封邮件 + 12~30 秒 | 保留（盯 81→98 反弹） |
| product-map-sync-daily | C | ≈40 秒 + GitHub API | 停或降到每周 |
| cron-run-logs-cleanup | A | 3 秒 | 保留 |
| goals-expiry-check | A | ≈10 秒（GitHub 免费额度） | 保留（揭示「除 CTS 外无进行中目标」） |
| conversation-health-heartbeat（Inngest） | D（疑似没跑） | 没法估 | 先去 Inngest 后台核实 |
| conversion-daily-pipeline（Inngest） | A | 约 7 分钟/天 + Claude 审核（未记账） | 保留 |
| crm-lead-followup-digest（Inngest） | D（邮件开关没开） | 2~6 分钟/天 | PM 决定开还是停 |
| lead-sheet-sync（Inngest） | A（带重复写入疑点） | 24 次 Sheets API/天 | 保留，立刻核对表里有无重复行 |
| gsc-page-daily（Inngest） | A | ≈0（Google 免费） | 保留 |
| flywheel-seo-weekly（Inngest） | B | ≤4 次 DataForSEO/周 | 保留 |
| competitor-watch-weekly（Inngest） | D（没客户开开关） | ≈0 | 打开 CTS 开关或停 |
| ai-visibility-weekly（Inngest） | D（旧链在干活，新链没切换） | ≈0 | 不动/切换时再启 |
| seo-meta-cycle（Inngest） | A | 只对过闸候选花钱，未记账 | 保留 |
| seo-meta-rank-sampler（Inngest） | C（暂，10-16 复查） | 现在 0；到期后 ≤30 SERP/天 | 保留 |
| simaqian-reputation-weekly（Inngest） | B | ≈$0.0003 | 保留 |
| libai-prompt-library-monthly（Inngest） | B | 0 | 保留 |
| web-intelligence-due（Inngest） | D（卡住 8 天） | 卡前约 NZ$0.05 | 改（reconciliation 当终态） |
| web-intelligence-traffic-due（Inngest） | C（无证据） | 关则 0 | 核对环境变量，关着就停 |

计数：29 个任务，A 8、B 8、C 4、D 9（seo-meta-rank-sampler 与 conversation-health-heartbeat 的档位是暂定）。

---

# 跨任务发现（给 PM 的关键信息）

1. **lead-sheet-sync 回执显示每小时往 CTS 留资总表重复追加同样 5 条线索（疑点，未能读客户表格验证）**，与 CRM 读到的行数增长矛盾，需有人打开表格核对。
2. **proposal-view-digest 4 次有访客的日子，4 次邮件全没送出**（发信人用了会被 403 的沙盒地址）；Carrington Estate 方案被打开 5 次。
3. **整条「分析→处方→记忆」自动链实际只服务 CTS 一个客户**：其他客户因目标到期无人续，处方每周空转；而记忆（memory-extractor）与周更学习（agent-learning-rollup，11 周从没写成过）自动链又都读不到。
4. 三个「死守着没人看」的循环：execution-auto-run（空跑 2 个月）、team-memory-sweeper（上游 8-22 起停、705 次空跑）、product-map-sync。
5. web-intelligence-due 自 9-29 起因一行「reconciliation」状态永久卡死，竞品抓取静默停摆 8 天；它和 heartbeat 都不在 CRON_REGISTRY，健康检查看不到。
