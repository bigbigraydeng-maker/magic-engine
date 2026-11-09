# 审计 G2 第 4 组（7 个任务，只读）

数据口径：logs14.json（过去 14 天 cron_run_logs）+ 只读生产库 SELECT（2026-10-07 查）。仓库路径省略前缀 `src/`，均在 `/Users/raydeng/Projects/magic-engine/.claude/worktrees/nifty-sanderson-f7ce97` 下。

---

### blog-weekly（每周二 03:00 UTC）
- 写入：`blog_posts`（status='draft'，`lib/blog/weekly-blog.ts:268-292`）；另写一条 flywheel 动作 PUBLISH_BLOG（`weekly-blog.ts:296-310`）。不发布。只处理 `seo_config.weekly_blog=true` 的客户，生产库只有 2 个：CTS Tours NZ、oztop。
- a) 最近运行：2026-10-06 03:01 completed（生成 2 篇）。14 天 3 次全 completed，processed 合计 6，completed 合计 3（9-29 那次两客户都因「6 天内已有稿」跳过）。
- b) 读取方：① Blog Studio 页面 `app/dashboard/clients/[id]/blog/page.tsx`（人工打开）；② 今日待办 `lib/pm-todo/blog-drafts.ts:115` → `pm-todo/manual-items.ts:771`（kind=blog_draft_waiting / blog_publish_channel_broken，`five-kinds.ts:127,103`）；③ `daily-todo.ts:508` 的草稿计数；④ `lib/blog/draft-expiry.ts:32`（由 `app/api/cron/seo-patrol-daily/route.ts:114` 调用）30 天没人动就自动标 rejected。
- c) 读取方在跑吗：pm-daily-todo 14 天 10 次全 completed（最近 10-05），seo-patrol-daily 9/10 completed（最近 10-06）。读取方本身在跑。
- d) 改变过决定吗：证据是反的。生产库 blog_posts 共 41 行：published 8 篇，**最后一篇上线是 2026-06-19**（oztop）；之后 3.5 个月 0 篇上线。rejected 24 篇里 **20 篇是 30 天没人动被系统自动标 rejected**（`quality_check.auto_expired=true`，查询结果 RANGE 0-0/20），只有约 4 篇是人工拒绝；当前还有 7 篇 draft 在排队，最老的 9-08 将在 10-08 左右到期。待办在天天推，但没有可见的人去点发布。另外 flywheel 动作登记的是「PUBLISH_BLOG」，而这些稿子没发布，会让后面的「效果归因」读到没发布的动作（需另查，本组未验证）。
- 结论：B（有人读，但没改变任何决定；产出在堆积、过期）；每天花费：约 $0.01–0.02/天。依据：9 月起 8 篇稿 cost_usd 合计 $0.42（约 $0.05/篇），周写 2 篇 ≈ $0.014/天，另有站内查重抓取 + 模型二次判断（未记入 cost_usd，没法精确估）；Render 单次 38–185 秒；建议：改。先别停，卡点是「发布」不是「生成」：oztop 的 WordPress 通道坏了（见 cms-connection-retest）、CTS 走 github 通道但无人点发布。建议 PM 先定「到底要不要发」，否则每周白写 2 篇再自动作废。

### blog-stuck-generating-sweeper（路由 blog-stuck-generating，每小时第 45 分）
- 写入：只在发现卡住的行时 UPDATE `blog_posts.status='failed'`（`app/api/cron/blog-stuck-generating/route.ts:62-65`）；平时只做一次 SELECT（同文件 :40-44）。
- a) 最近运行：2026-10-06 15:45 UTC completed。库里有记录的 191 次**全部 completed、processed 全 0**（运行记录从 9-28 17:45 开始，约 8.7 天，每天 24 次；注意 191 次不是 14 天，是记录只从 9-28 开始）。平均 932 毫秒/次，14 天内合计约 178 秒。
- b) 读取方：它写的 failed 状态被 Blog Studio 页（`blog/page.tsx:128,229,566`、`blog/[postId]/page.tsx:91,287`）用来显示「生成中/失败」。「generating」这个状态**只有人工在 Blog Studio 点生成时才产生**（`app/api/clients/[id]/blog/route.ts:198`，且代码 :282-288 自己在失败时已把行改 failed）；周更 cron 不产生该状态（`weekly-blog.ts` 直接落 draft，grep 无 generating）。
- c) 读取方在跑吗：Blog Studio 是人工页，无法验证有无人打开；但这个「卡死」场景要求「后台生成中途 Render 重启」。
- d) 改变过决定吗：生产库当前 generating = 0 行，failed 只有 2 行（都是 CTS，空标题空内容，两行 updated_at 完全相同 2026-06-01 12:00:13.98，疑似被它一次扫的，唯一一次可能的真实产出；这条是推断，不是已证实）。该 2026-06 之后 4 个月无新增 failed。render.yaml:200-206 里已记录 8-03 当时「24 小时 96 次全部零产出」，`docs/audits/supabase-request-audit.md:76` 同样。
- 结论：C（几乎没有产出，几乎纯空转；保险性质）；每天花费：每天 24 次 Render 启动 + 24 次 `blog_posts` 表 SELECT，合计 Render 约 22 秒/天、数据库极轻（`supabase-request-audit.md:226` 记录该表读请求主要来自 blog 页 5 秒轮询，不是它）；美元没法估：缺 Render 对 cron 的按服务最低计费账单，Render 每个 cron 服务是独立计费项，这条的真实成本是「多一个 cron 服务」而不是跑的秒数；建议：停并入（把这一步并进 seo-patrol-daily 已有的每日任务里，或改成每天 1 次），不需要单独一个每小时的服务。

### cms-connection-retest（每天 06:10 UTC）
- 写入：`cms_connections.status/last_tested_at/last_error`（经 `lib/cms/connection-store.ts:319-330,500-511,690-701`，只碰 status='error' 的行，`lib/cms/retest.ts:120-123`）。外部副作用：对客户的 WordPress / GitHub 发 1 次认证探测。
- a) 最近运行：2026-10-06 06:10 completed；14 天 14/14 completed，processed 合计 28（每天 2 条），**completed_count 合计 0（从没恢复过一条），failed_count 合计 28**。
- b) 读取方：① 今日待办 `lib/pm-todo/blog-drafts.ts:129,50`（只看 status==='connected' 与否来决定说「去审稿」还是「通道断了，去接通」）；② 发布接口 `app/api/clients/[id]/cms/publish-wordpress/route.ts:36,118`、`publish-shopify`、`wordpress/update-post/route.ts:48,94,198`（读连接）；③ `lib/clients/cross-client-audit.ts:148-168`（串台审计，读 site_url 不读 status）；④ 设置页 CmsPanel。
- c) 读取方在跑吗：pm-daily-todo 在跑（见上）；发布接口是人工触发。
- d) 改变过决定吗：无证据。生产库 4 条连接：oztop WordPress = error（last_error 是客户主机商的 sgcaptcha 验证码拦截，last_tested_at 2026-10-06，**每天被重测 14 天连续失败，自 2026-06-19 起一直 error，约 110 天没恢复**）；CTS WordPress = error（连接指向别的客户的站，被 `retest.ts:158-171` 判「配错」，**每天跳过不测**，last_tested_at 停在 2026-05-25，只是每天被数成一次 still_broken）；CTS github、Magic Engine github = connected（正常的它不碰）。它的唯一使命是「让临时拦截自己好」，实际 0 次成功。
- 结论：B（有人读状态，但这个任务本身 110 天没改变任何一条连接，读取方的决定也没因它变）；每天花费：外部几乎 0（1 次对 oztop 的探测 + 1 次 DB 读取，单次约 2 秒）；Render 约 2 秒/天；建议：改。oztop 是被主机商验证码拦，机器每天再撞一次只是加深对方防火墙的敌意（`cms-connection-retest/route.ts:10` 自己的注释也这么说）；而「CTS WordPress 配错」是一条被天天当成「失败」统计、但需要人纠正的数据问题，应当进待办而不是靠它每天报。两条都应该走人工待办或一次性处理，而不是继续每天探测。

### reputation-snapshots-weekly（每周一 03:30 UTC）
- 写入：`reputation_snapshots`（评分/评论数，`lib/reputation/snapshots.ts:275`）、`review_items`（评论明细，:289）。外部调用 DataForSEO business-data（GMB 信息 + 评论任务）。只处理 active 且配了口碑身份的客户，目前 3 个：CTS、Roman HU、oztop。
- a) 最近运行：2026-10-05 03:31 completed。14 天 2 次全 completed（processed 3、failed 0），共写 snapshots 6 条、reviews 4 条（9-28 写 3 条评论，10-05 写 1 条）。库里累计 13 次运行，最早 2026-08-01。
- b) 读取方：`reputation_snapshots` → `lib/web-intelligence/competition-sources.ts:41`（竞争简报「客户评价」维度，由 `app/api/clients/[id]/web-intelligence/route.ts` 经 `service.ts` 供行业基线页 `WebIntelligencePanel` 展示）。`review_items` → `inngest/functions/simaqian-reputation-weekly.ts:64`（司马迁起草回复）。两张表没有其它读取方（grep 全仓除快照写入文件、迁移和测试外只有这两处）。
- c) 读取方在跑吗：司马迁周巡真跑过（见下一条）；简报页要人工打开，无法验证有没有人看。
- d) 改变过决定吗：有一处可举例：9-30 周巡读取了 oztop 本轮 2 条新好评，生成 2 条回复草稿 + 1 篇好评帖草稿并进了今日待办；但没有证据 PM/FDE 真去 Google 商家后台贴了回复（待办只能看到下发，无落地回写）。评分本身 4 周几乎不变（CTS 4.4/12 条、oztop 5.0、Roman 5.0），没看出评分触发任何决定。生产库 `reputation_snapshots` 25 行全是客户自己的 GBP，**竞品 0 行、Tripadvisor 0 行**，所以竞争简报的「评价」维度实际只有客户自己的单点，没有可对比对象。
- 结论：B（有读取方、产出有用于司马迁草稿，但没有证据改变过决定；竞品部分是空的）；每天花费：约 $0.003/天，依据：`lib/dataforseo/business-data.ts:14-17` 单价（GMB ~$0.002/次、评论 ~$0.00075/10 条），每周 3 客户 × 约 2–3 次调用 ≈ $0.02/周；Render 约 50 秒/周；建议：保留（极便宜，且是司马迁的数据源），但竞品没配的话简报页的「评价」维度没价值。

### simaqian-reputation-weekly（Inngest，每周四 09:00 NZ，`inngest/functions/simaqian-reputation-weekly.ts:29,113`）
- 写入：只写 `cron_run_logs` 回执（`:155-162`，含起草的回复、好评帖草稿、cost_usd）；不发布（`no_publish: true`）。外部：Claude 起草回复。
- a) 最近运行：2026-09-30 20:03 UTC（=10-01 周四早上 NZ）completed，14 天内仅 1 次（processed 10 个 active 客户，completed 9，failed 1）。起草 oztop 的 2 条回复 + 1 帖，成本 $0.002242；其余 8 个无新评价；Roman HU 1 条 5 星评价**没有文字 → 被判 draft_failed**。下一次 10-08。
- b) 读取方：`lib/pm-todo/simaqian-review-items.ts:110-150`（读最近一次运行记录，≤6 天，生成 simaqian_review_drafts / simaqian_patrol_failed 待办），在 `pm-todo/manual-items.ts:331` 接入，`five-kinds.ts:127` 归「发出去前要看一眼」。
- c) 读取方在跑吗：pm-daily-todo 在跑（10/10 completed），读取逻辑真实调用点已确认（manual-items.ts:89,331）。
- d) 改变过决定吗：无证据（待办下发了，但没有回写表明有人去 Google 后台回复）。**发现一个误报**：Roman HU 只有星级没有文字的 5 星评价被记成「失败」（`error: 评价只有星级没有文字，不起草`），`simaqian-review-items.ts:62-72` 会据此下发「司马迁本周没巡成 Roman HU…回我一句『查一下司马迁』」，其实机器没坏，把没文字的好评当故障上报，会制造一个假待办。
- 结论：B（接入了待办、一次真产出，但没证据改变任何决定；有一处假待办）；每天花费：约 $0.0003/天（$0.002/周 LLM）+ Inngest 执行，量极小；建议：保留，改一处：把「只有星级无文字」归为 no_new_reviews/跳过而不是 draft_failed，避免假待办。

### job-boards-weekly（每周一 02:00 UTC）
- 写入：设计上写 `outbound_prospects`（discovery_source='job_board'，`lib/prospecting/job-boards/ingest.ts:139-147`）；实际一行没写。外部：Seek 抓取 + Google Places 解析公司（`ingest.ts:105`）。
- a) 最近运行：2026-10-05 02:01 completed；14 天 2 次全 completed，processed 全 0；运行记录里累计 8 次（自 2026-08-17），**8 次的 summary 全是 `skipped: disabled`**——主开关 `JOB_SIGNAL_INGEST_ENABLED` 没开（`app/api/cron/job-boards-weekly/route.ts:37-42`，summary 查询已证实）。
- b) 读取方：`outbound_prospects` 里 discovery_source='job_board' 的行 **0 行**（查询 RANGE */0），所以没有任何东西读到它的数据；下游 prospecting-sweep（render.yaml:157）本该接着审计。
- c) 读取方在跑吗：D（读取方已坏）：prospecting-sweep 14 天 336 次**全部失败**，原因是 Google Places 账单没开（REQUEST_DENIED）；而 job-boards-weekly 自己即使打开开关，也要用同一个 Google Places 去解析公司（ingest.ts:105），同样会被拒。
- d) 改变过决定吗：无证据（一行数据都没产生过）。
- 结论：D（读取方没启用/已坏；任务本身 8 周每周只是空转走一遍开关）；每天花费：几乎 0（每周 1 次、172–207 毫秒、一次 DB 写运行记录）；建议：停（或保持当前状态但标「暂停」）。成本小，但它每周一在生成一条「成功」记录，会误导；真要开得 PM 先决定开外呼线 + 修 Google Places 账单（render.yaml:187-191 的注释也这么说）。

### market-intel-daily（每天 18:00 UTC，内部叫 Magic Insight）
- 写入：`market_intel_sources`（20 个信源）、`market_intel_items`（原始条目，累计 5294 行，每天约 160 条 upsert，无清理）、`market_intel_digests`（441 行，其中 409 通过核对、32 条没通过）、`market_intel_daily_notes`（45 行）（`lib/market-intel/pipeline.ts:51-71,206-238`）；外部副作用：每天 20 个 RSS 抓取 + OpenAI（gpt-4o-mini，`lib/market-intel/summarize.ts:3`）约 10–16 次摘要 + 1 次编者按 + **1 封 Resend 邮件到 hello@**（`pipeline.ts:263-275`）；信源健康告警另发一封（`:277-297`）。
- a) 最近运行：2026-10-05 18:01 completed。14 天 14 次：13 completed、1 failed（9-22：`429 You have no credits remaining`——OpenAI 额度用光，整站同时受影响）。processed 合计 2244（=候选条目数 itemsConsidered，不是处理成功数），completed 合计约 129（每天进邮件的条数）。**每天 failed_count=1 不是流水线坏了，而是 VentureBeat AI 这个信源 32 天连续抓取失败**（生产库 `market_intel_sources`：consecutive_fail_count=32，last_success_at=2026-09-03）；Search Engine Land 已被停用（enabled=false）。
- b) 读取方：全仓 grep `market_intel_`/`market-intel`：除管线自己（去重读 digests `pipeline.ts:169`、健康度读 items `:256`）外，**没有任何页面、API、别的定时任务、Kernel、日报/周报读这四张表**。唯一出口是邮件到 hello@。`lib/magic-insight/prepublish-check.ts:24` 只借用了 grounding 的数字提取函数，不读这些表。设计文档 `docs/specs/2026-08-20-market-intel-digest-design.md:1-9` 明确写「PM 个人使用的每日全球资讯雷达，纯内部工具，不对外发布，不展示在官网」。
- c) 读取方在跑吗：读取方就是 PM 邮箱，无法用数据验证有没有人读；没有邮件打开/回复记录可查。
- d) 改变过决定吗：无证据。库里条目内容质量有可见问题：10-06 的 digest 里 llm_news 类出现「CIP 与 Grok Ventures 支持安托拉能源项目」「巴乌米亚如何为加纳奠基」（命中了关键词但与大模型无关），ai_startup 类有「Hot Girl Hotline」，china_outbound 类有「阿联酋与卡塔尔金融新闻汇总」被判核对失败。说明分类靠关键词匹配、混入不相关内容。没有任何证据表明这些资讯触发过产品、客户、投放决定。
- 结论：B（有人读：邮件到 PM 邮箱，没读取程序；没有证据改变任何决定；另有一个已死 32 天的信源和每天重复的健康告警邮件）；每天花费：OpenAI 约 $0.002–0.005/天（估算：约 16 条×约 500 token + 1 次编者按，gpt-4o-mini $0.15/百万输入、$0.60/百万输出，实际 token 没有记录，没法精确估），Resend 邮件 1–2 封/天，Render 约 17–21 秒/天，Supabase 约 160 次 upsert/天；金额很小，真正的成本是「每天一封可能没人读的邮件 + 健康告警邮件天天重复」；建议：改。先问一句 PM 还看不看（没读 = 停）；要留则 ① 把已死 32 天的 VentureBeat 信源关掉（否则每天都发同一条告警）② 把 failed 计数改成不把「信源挂了」算进任务失败，避免待办里每天看到 failed。

---

## 汇总表

| 任务 | 结论 | 每天花费 | 建议 |
|---|---|---|---|
| blog-weekly | B（有人读，没改变决定；最后上线 6-19，24 篇 rejected 里 20 篇自动过期） | 约 $0.01–0.02 | 改：先定要不要发，别继续白写自动作废 |
| blog-stuck-generating-sweeper | C（191 次全 0；历史上可能只扫过 1 次） | 约 22 秒 Render，没法估美元（缺 Render 计费） | 停并入每日任务 |
| cms-connection-retest | B（14 天 0 恢复，28 次全失败，oztop 已断约 110 天） | 约 0 | 改：配错通道进待办，被拦的别天天撞 |
| reputation-snapshots-weekly | B（供给司马迁；竞品 0 行、Tripadvisor 0 行） | 约 $0.003 | 保留 |
| simaqian-reputation-weekly | B（真产出 2 条回复草稿，无落地证据；Roman 无文字好评被误报失败） | 约 $0.0003 | 保留 + 改误报 |
| job-boards-weekly | D（开关没开 8 周全空转；下游 prospecting-sweep 336 次全失败） | 约 0 | 停（标暂停） |
| market-intel-daily | B（只发邮件，库里 4 张表无读取方；VentureBeat 死 32 天） | 约 $0.002–0.005 + 邮件 | 改：先问 PM 还看不看 |
