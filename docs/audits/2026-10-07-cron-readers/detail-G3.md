# G3 组审计：内容工厂 / 爆款库 / 外联 / 各类扫尾任务（16 项，只读审计，今天 2026-10-07）

## 读这份报告前必须知道的两件事

1. **cron_run_logs 的「空记录」7 天后会被清掉**（supabase/migrations/20260907000001_cron_run_logs_retention_daily_job.sql:53-65，只删「跑完、没 summary、没 error、processed=0」的行，每个任务保留最新一条）。所以 logs14.json 里「零产出」任务的运行次数只有近 7 天是全的（例如 vision-analyzer 从 09-28 17:50 才有行，之前 5 行是 processed>0 的）。判断「14 天零产出」靠的是：**任何 processed>0 / 有 summary 的行都会被保留，窗口里一条都没有 = 真零产出**。
2. **Render 上的 cron 服务本身只是一条 curl**（render.yaml 里 startCommand），真正干活的是常驻网站服务，所以「每天花费」里 Render 算力只算网站请求时长，不额外计费；每个 Render cron 服务自己的月最低额我没法核对（缺 Render 账单）。下面「花费」栏只写外部接口/模型的钱。

查询方法：生产库 PostgREST 只读 GET，钥匙只在命令内读取、未打印未落盘。（注：我第一次用 `source .env.local` 时 shell 在第 78 行报语法错误，把那一行回显到了我的命令输出里——是 OZTOP WordPress 应用密码，不是库钥匙；已改成只 grep 取两个变量。这行回显留在了本会话的工具输出里，建议 PM 知悉，必要时轮换该密码。）

---

### vision-analyzer （每小时第 50 分，Render）
- 写入：`client_assets`（status→analyzing/analyzed，写 vision_metadata/hook_score/middle_score/cta_score/recommended_use），外部：每张图 1 次 GPT-4o-mini Vision（src/app/api/cron/vision-analyzer/route.ts:99-135）。
- a) 最近运行：191 次全 completed，最近 2026-10-06 15:50；窗口内 processed 合计 0（全 0）。上一次有产出是 2026-09-16 00:50（6 张）。生产库 client_assets 共 140 行，pending=0，最新一行创建于 2026-09-21 17:22（说明 9-22 之后没有新素材进来）。
- b) 读取方：asset-library 选图接口 `src/app/api/clients/[id]/asset-library/search/route.ts:53`（按 analyzed 状态选图）；分镜生成 `src/lib/assets/storyboard-generator.ts:63-89`（按 hook_score 选开场图）；素材页 `src/app/dashboard/clients/[id]/assets/page.tsx:121-187`（显示分数条）；`src/app/api/clients/[id]/assets/route.ts:36`。
- c) 读取方在跑吗：页面和接口都是按需调用，没有定时任务读它；库里 138 条 analyzed 供它们读，读得到。但本任务 14 天没处理过任何新图。
- d) 改变过决定吗：无证据（没有「某天某客户因分数选了某图」的记录）。
- 结论：**B**（有读取方，但 14 天零产出；不是坏了，是没有新素材可分析）；每天花费：≈ $0（零张图；单张 4o-mini 视觉按公开价约 $0.001 量级，没核对账单）；建议：**改**——别每小时空轮询，改成「客户上传素材那一刻触发」（Inngest 事件），或降到每天 1 次；render.yaml 注释里 08-16 已因同样原因从 */30 降过一次。

### poll-visual-jobs （每小时第 15 分，Render）
- 写入：`reels_drafts`（video_generating→video_ready/images_ready）、`visual_assets`（generation_status/cost_usd）、`generation_attempts`；外部：向 Atlas/Seedance/HeyGen 查任务状态（poll-visual-jobs/route.ts:46-130）。
- a) 最近运行：192 次全 completed，最近 2026-10-06 16:15；processed 合计 0，历史上从未有过 processed>0 的保留行。
- b) 读取方：ReelsStudio 界面（`src/app/dashboard/clients/[id]/_components/ReelsStudio.tsx:179-205` 每 30 秒问 /video-status，状态靠本 cron 落库）；视觉页 `src/app/dashboard/visuals/page.tsx`（supabase-request-audit.md:219 记录）。
- c) 读取方在跑吗：界面在，但没人点「生成视频」：reels_drafts 37 行，当前 video_generating=0，最后一次 video_ready 更新于 2026-07-18；visual_assets 最新行 2026-06-07；generation_attempts 表空。
- d) 改变过决定吗：无证据（最近一次真实使用是 07-18，早于审计窗口近 80 天）。
- 结论：**B**（读取方活着但没人触发，近 80 天零使用）；每天花费：≈ $0；建议：**停/改**——这个功能的触发方（生成按钮）近 80 天无人点，改成「点按钮后由 Inngest 延迟检查」比每小时空转合理；render.yaml 里 08-03 写的「刻意不降频」结论已被 08-16 推翻过一次，现在连每小时都是浪费。

### viral-analyzer-worker （每 10 分钟，Render；14 天 2016 次）
- 写入：`viral_reference_library`（analysis_status：pending/error→analyzing→done/error，写 style_scores/shot_recipe 等）；外部：每条 1 次 Gemini 2.5 Flash（YouTube 直接传链接；小红书类先用 yt-dlp 下载再上传 Gemini Files）（route.ts:52-100，src/lib/reels/viral-analyzer.ts:124-187、395-440）。
- a) 最近运行：2016 次全 completed，最近 2026-10-06 16:10；processed 合计 **8064**（= 每次 4 条 × 2016，每次都满）。**但真正分析成功的只有 11 条**：库里 analyzed_at ≥ 09-22 的行共 11 条（最后一条 2026-10-05 00:11）；同期新增 180 条，169 条停在 error。
- 为什么（证据）：
  - 当前库：3581 行 = done 2840 / error 737 / analyzing 4 / pending 0。
  - 09-22 之后新增行的报错 166/169 是 `429 … generate_content_free_tier_requests, limit: 20, model: gemini-2.5-flash`（GenerateRequestsPerDayPerProjectPerModel-FreeTier，每天只给 20 次）——**这把 Gemini 钥匙目前走的是免费档，每天 20 次**；另有 1 条 403 `dunning decision is deny`（账单被拒）、379 条历史 403。
  - 队列没有 pending 后，worker 每 10 分钟取「最老的 4 条 error」重试（route.ts:55-62，按 created_at 升序）。最老的是永久失败的行：1 条 `PROHIBITED_CONTENT`（06-03）、小红书链接 yt-dlp 下载失败 99 条（07-24 起，库里小红书 195 条其中 101 条 error）。这几条**永远成功不了却永远排在最前面**，每天白跑约 138 次（144 次 − 刚入库 pending 那几轮），把队列头堵死。
- b) 读取方：`src/lib/factory/viral-structure.ts:130`（出片时取同行业爆款节奏数字，样本 ≥8 才用；调用方 `src/lib/factory/evaluate.ts:201`）、`src/lib/reels/viral-style-advisor.ts:161-198`（reels 生成接口 `src/app/api/clients/[id]/reels/generate/route.ts:22`）、`src/app/api/clients/[id]/social-plan/route.ts:254-266`、`src/lib/marketing-plan/generator.ts:309`、后台 `src/app/api/admin/viral-references/*`。
- c) 读取方在跑吗：这些是按需调用，库里已有 2840 条 done 可读，读得到；evaluate.ts 的调用方是工厂排单（`factory-order-scheduler` 全客户开关关着，见下），以及手工信号 /api/factory/signals。
- d) 改变过决定吗：无证据（viral-structure.ts 头注称 PM 因「节奏偏慢」退回 CTS 一条片后才接入，未见某天某单被它改变的记录）。新增 11 条相对已有 2840 条几乎不影响任何读取方结果。
- **连带伤害（强怀疑，未证实因果）**：同一把 `GEMINI_API_KEY` 还被 AI 可见度的 Google 探针（`src/lib/ai-tracker/runners/gemini.ts:23`）和马良看片质检（`src/lib/maliang/render-check.ts:337`）使用。生产库 `ai_visibility_runs` 里 engine=google 自 09-22 起 494 条里 **491 条失败**（09-27 一轮 246/247 失败、10-04 一轮 245/247 失败），报错同样是 429 quota。本 worker 每天凌晨一次性把 20 次免费额度烧光（最多 4 次/10 分钟），其他功能抢不到额度的可能性很大；因果没单独验证（需要看 Google 控制台的用量）。
- 结论：**B（实质已坏）**——有读取方，但 14 天只成功 11 条（0.14%），且占着唯一一把 Gemini 钥匙的免费额度；每天花费：Gemini 钱 ≈ $0（429 不扣费，11 次成功在免费档内）；网站请求时长约 67 分钟/天（27.9s × 144）；建议：**停 + 修**——先停（或让它跳过永久失败行：加重试次数上限/按 error 类型分流），并给 Gemini 开付费档；开了付费档后再恢复，否则它在拖累 AI 可见度和马良。

### viral-discovery-weekly （实际每天 00:00 UTC，名字里的 weekly 是历史遗留；Render）
- 写入：`viral_reference_library` 新增 pending 行；外部：YouTube Data API（render.yaml:484-487 估 5760 单位/天，免费配额 1 万）。
- a) 最近运行：14 次全 completed，最近 2026-10-06 00:01；processed 合计 672（每天 48 个关键词组合）；summary.total_queued 每天 7–14 条，14 天约 180 条新行（与库里新增 180 条吻合）。
- b) 读取方：同上（爆款库读取方）；其中真正等「分析结果」的读取方只认 analysis_status=done 的行。
- c) 读取方在跑吗：读取方在，但新入库的行 169/180 卡在 error，上面那条 worker 没把它们变成可用数据。
- d) 改变过决定吗：无证据。
- 结论：**B**（每天扩充一个已有 2840 条的库，新增几乎全卡死在分析环节）；每天花费：≈ $0（YouTube 免费配额内）；建议：**停到分析环节修好为止**——往一个后续分析不了的队列里每天塞 13 条没有意义；修好 Gemini 额度后保留，并考虑降到每周一次（库已够大，且 min-sample 只要 8 条）。

### content-factory-intake （每天 22:00 UTC，Render）
- 写入：`content_posts`（status=draft、route_a、source=「抓自：<标题>」）；外部：Apify 抓小红书+抖音（zen-studio/rednote-search-scraper、douyin-search-scraper），再用选题助理（模型改写）每客户每次 5 条（src/lib/content-factory/intake-runner.ts:62-125）。
- a) 最近运行：14 次全 completed，最近 2026-10-05 22:01；processed 合计 16（只有 2 个客户开了：CYHB Fashion 每天、Magic Lab Class 每周一）。**但自 2026-09-28 起每次 scanned=0 / created=0**（09-22~09-27 每天还有 1–4 条；之后 9 天全 0）。路由把错误吞了（`void e`、runIntakeForClient 的 errors 数组没写进 summary，cron/content-factory-intake/route.ts:33-40），所以看不出是 Apify 抓不到、额度用完还是被封——这本身是个「失败静默」问题。
- b) 读取方：`content_posts` 被客户门户内容页、`src/app/dashboard/clients/[id]/_components` 内容看板（`src/app/api/clients/[id]/content-factory/board/route.ts`）、portal 页读取。
- c) 读取方在跑吗：页面在；但进料产生的帖子库里共 139 条（CYHB 114、Magic Lab Class 25），**138 条还是 draft、1 条 rejected，没有一条被推进到审核通过/排期/发布**；最近一条是 09-27。
- d) 改变过决定吗：无证据（139 条里没有任何一条走完流程）。
- 结论：**C**（产出堆在草稿区没人推进，且 09-28 起上游已抓不到数据）；每天花费：没法估（缺 Apify 账单；每次 2 个 actor × 每个开着的客户，模型改写 5 条约几美分）；建议：**停**（或先改成把 errors 写进 summary 再看值不值得救）；若要保留，先问 PM 这批草稿有没有人看。

### factory-publish-worker （每小时第 5 分，Render）
- 写入：`content_work_orders`（approved→publishing→published，published_ref）、FB Reel（目前是草稿模式）、讲课片发布、补喊 `me/factory.reel.published` 事件、Instagram 交叉发布（route.ts:40-79）。
- a) 最近运行：336 次全 completed，最近 2026-10-06 16:05；summary 里 400 次查询中 398 次 `no_candidate`、**2 次 published**（2026-10-05 06:05 订单 9fcb4ae6、2026-10-06 08:05 订单 e8c5b66a），全部 `live:false`（FACTORY_PUBLISH_LIVE 没开 = 只发 FB 草稿，不公开）。processed 栏恒为 0 是因为路由没填它（只写 summary），不是没处理。
- b) 读取方：`content_work_orders` 被工厂审核页 `/dashboard/factory`、今日待办（`src/lib/pm-todo/manual-content-items.ts`）、Inngest 广告衔接事件读取；这条 worker 是 approved→published 的唯一出口。
- c) 读取方在跑吗：pm-daily-todo 14 天跑了 10 次（周五六不跑，正常）全 completed；工厂页是人工页面。
- d) 改变过决定吗：有——两张 CTS 订单从「审核通过」变成「FB 草稿已发」（订单 id 如上，订单 rationale 是 PM 10-06 授权的上海周边团降价 Reel，只存草稿不公开）。
- 结论：**A**；每天花费：≈ $0（FB 发布本身不收费；每次约 1.7s）；建议：**保留**。注意：每小时才轮一次，approved 后最坏要等 55 分钟才开始发；另外 FACTORY_PUBLISH_LIVE 未开，现在发出的只是草稿。

### factory-order-scheduler （每天 20:00 UTC，Render）
- 写入：对开了 `factory_config.auto_order_enabled` 的客户下工单（走 evaluateSignal）→ `content_work_orders`/`signals`（order-scheduler.ts:79）。
- a) 最近运行：14 次全 completed，最近 2026-10-05 20:01；processed 合计 0，历史上无 processed>0 行。
- b) 读取方：（它写的东西）工厂工单后续流程（worker 领单→审核→发布）。
- c) 读取方在跑吗：工厂后段在跑，但**全库 38 个有 factory_config 的客户里没有一个把 auto_order_enabled 设为 true**（CTS、NM Medspa、East International 显式是 false，其余没设）——所以本任务每天都是空转，summary.note 也写着「没有客户打开自动下单开关，本轮空转」。
- d) 改变过决定吗：无（从未下过单；现有 41 张工单都是 PM 手工授权出的）。
- 结论：**C**（开关全关）；每天花费：$0；建议：**停**（或保留但降成每周一次）——哪天要开自动下单再恢复；渲染 14 天零成本，主要是维护噪音。

### factory-publish-sweeper （每小时第 25 分，Render）
- 写入：`content_work_orders`（publishing 超 10 分钟 → 回 approved）（route.ts:25-37）。
- a) 最近运行：336 次全 completed，最近 2026-10-06 15:25；processed 全 0；历史上无 processed>0 行（从未收回过任何一张卡死订单）。
- b) 读取方：publish-worker 下一轮重新领单。
- c) 读取方在跑吗：在跑（见上）。
- d) 改变过决定吗：无证据（从未触发）。
- 结论：**C**（保险丝，从未熔断）；每天花费：≈ $0；建议：**改**——这是 publish-worker 的收尾逻辑，可以并进 publish-worker 每轮开头顺带做，省掉一个独立 Render 服务；不必单独占一个定时任务。

### factory-worker-sweeper （GitHub Actions，名义每 5 分钟，不在 render.yaml）
- 写入：`content_work_orders`（claimed/producing 心跳超 10 分钟 → 回 queued、reclaim_count+1）；**不写 cron_run_logs**（所以 logs14.json 里没有这个任务）。
- a) 最近运行：workflow `.github/workflows/factory-sweepers.yml`，GitHub 最近 100 条运行里 09-23 之后 73 次，全 success；**实际约每天 5 次而不是名义的 288 次（约 1.8%）**——GitHub 定时是「尽力而为」，间隔常在 3–7 小时（最近几条：10-06 15:28、08:47、01:57、10-05 21:51、14:56…）。winner-reel 那条同样的问题 07-12 已因此搬到 Render（winner-reel-sync-daily.yml 注释）。
- b) 读取方：Mac 出片机领单时读 status=queued；`pushFactoryWorkerItems`（manual-content-items.ts:205-250）读的是心跳，不读它。路由里写的「②离线报警器数据→daily digest 消费，M2 后段接」从未接上（我没在 daily-cron-digest 里找到引用）。
- c) 读取方在跑吗：Mac worker 目前有 2 台在报活（factory-worker-alive：mac-ray-cts-one-shot-20260830 最近 10-06 16:19；mac-ray-remotion-packc-trial 最近 10-05 13:56）。
- d) 改变过决定吗：有历史证据：全库 4 张订单被它收回过（reclaim_count>0：08-03 一张、08-31 三张，其中一张 03f58fe… 收回后最终 published）；近 14 天 0 次。
- 结论：**A**（保险丝，历史上真救过单）；每天花费：≈ $0（GitHub Actions 每天约 5 分钟）；建议：**改**——名义 5 分钟实际 ~5 次/天，「10 分钟没心跳就收回」在现实里要等数小时；若真要保证时效，搬到 Render cron（同 winner-reel 的做法），否则把注释里的 5 分钟说法改成事实。

### factory-worker-alive （不是定时任务：Mac 出片机 ping 接口写入的心跳，复用 cron_run_logs）
- 写入：`cron_run_logs` 每台 worker 一行原地刷新（src/app/api/factory/worker/ping/route.ts:17-80）。
- a) 最近运行：库里 2 行（每台一行），status=completed；最近 10-06 16:19（mac-ray-cts-one-shot）和 10-05 13:56（mac-ray-remotion-packc-trial，已 1 天没 ping）。
- b) 读取方：`src/lib/pm-todo/manual-content-items.ts:221`（判断「队列有活但出片机离线」，推「需要你动手」待办）。
- c) 读取方在跑吗：pm-daily-todo 在跑（10/14，周五六不跑）。
- d) 改变过决定吗：无证据（当前没有 queued 订单，不会触发该待办）。
- 结论：**A**（是活的信号线，不是浪费）；每天花费：$0；建议：**保留**；顺带：试验用的 `packc-trial` worker 已一天没报活，若永不再用可清掉那一行以免误判。

### winner-reel-sync-daily （每天 15:00 UTC，Render；GitHub 同名工作流）
- 写入：`winner_reel_sync_log`（每次一行）；外部：读 FB 主页自然 Reel，在 CTS 的 Pool Builder 广告组里新增 **PAUSED** 广告 / 暂停表现差的广告（src/lib/winner-reel-sync/engine.ts:159-170 等）。
- a) 最近运行：14 次全 completed，最近 2026-10-06 15:01；只有 1 个客户（CTS）开着；14 天内**新增 1 条广告（09-23）、暂停 1 条（09-27）**，其余天都是 `min_active_ads_pause_stop` 守卫挡住（扫 30 帖、找到 4 个赢家、不动）。自 08-07 起 60 次里累计新增 3 条、暂停 1 条。
- **重复调度检查**：GitHub `winner-reel-sync-daily.yml` 只剩 `workflow_dispatch`（手动），scheduled 触发已于 07-12 移除；GitHub 上只有 1 次手动运行（2026-07-11）。**不重复**。
- b) 读取方：`winner_reel_sync_log` 在 src 里没有任何读取方（grep 只有 engine.ts 写入）；`winner_reel_sync_config` 被 `ad-health/execute-prescription/route.ts:59` 读。配置里 `slack_webhook_url` 为空，所以也不推 Slack。新建的 PAUSED 广告靠 FDE 在 Meta 里看。
- c) 读取方在跑吗：日志表无读取方；广告端是否有人审核 PAUSED 广告——无证据。
- d) 改变过决定吗：无证据（09-23 新增的广告是否被批准上线、09-27 暂停是否有人复核，库里查不到）。
- 结论：**B**（有真动作但无人读它的日志、无通知）；每天花费：≈ $0（Meta API 免费；8 秒/次）；建议：**改**——保留，但让它的结果进入待办或日报（不然新增/暂停广告无人知道）；GitHub 那份 dispatch-only 工作流可以删，但不会误触发。

### tailor-made-jobs-sweeper （每 30 分钟，Render）
- 写入：`tailor_made_jobs`（queued/running 超 10 分钟 → failed）。
- a) 最近运行：383 次（保留窗口约 8 天）全 completed，最近 2026-10-06 16:01；processed 全 0；历史上无 processed>0 行；库里没有一行带「任务卡住了」的错误文案（即从未清理过一条）。
- b) 读取方：`src/lib/tailor-made/jobs.ts`、`poll-job.ts`、`api/clients/[id]/tailor-made/jobs/[jobId]/route.ts`。这三处自己已有「被轮询到时惰性自愈」（路由头注释说明），本 cron 只是兜底「没人再轮询」的孤儿。
- c) 读取方在跑吗：功能在用——tailor_made_jobs 共 24 行，最近一条 2026-10-05 21:22 completed。
- d) 改变过决定吗：无（0 次清理）。
- 结论：**C**（兜底网，从未触发）；每天花费：≈ $0；建议：**改**——每 30 分钟 → 每天 1 次，足够兜住「用户关页面后不再回来」的孤儿。

### libai-prompt-library-monthly （Inngest 云函数，每周二 09:00 新西兰时间触发，函数内判断「本月 1–7 号」才真检）
- 写入：`cron_run_logs` 回执（不改任何文件）；检查 `docs/agents/prompt-library` 里 6 个 md 是否有过期引用（src/lib/content/prompt-library-audit.ts:145-186）。
- a) 最近运行：2 次 completed（14 天内每周二各一次）：09-29（NZ）skipped「不是本月第一周」；10-06（NZ 09:01，即 10-05 20:01 UTC）真检：files_checked=6，findings=[]。
- b) 读取方：`src/lib/pm-todo/libai-items.ts:130-200`（有 finding 才出「平台治理」待办；`src/lib/pm-todo/five-kinds.ts:181` 把这类归到「开发」）。
- c) 读取方在跑吗：pm-daily-todo 近 14 天 10 次 completed。
- d) 改变过决定吗：无（findings 为空，没出过待办）。
- 结论：**B**（有读取方，目前没发现任何问题）；每天花费：$0（不调模型、不写文件）；建议：**保留**（成本为零）。名字叫 monthly 但每周触发 4 次其中 3 次只写一条「跳过」记录，可以把触发改成月度 cron 以免产生噪音，非必须。

### zhangqian-sweeper （每小时第 35 分，Render）
- 写入：`client_discovery_jobs`（pending/running 超 12 分钟 → failed）。
- a) 最近运行：191 次全 completed，最近 2026-10-06 15:35；processed 全 0；历史上无 processed>0 行；库里没有任何一行带「sweeper」超时错误信息。
- b) 读取方：`src/lib/zhangqian/agent.ts`、`persistor.ts`、`start-advanced-discovery.ts`、`api/zhangqian-revalidate/route.ts`（状态路由也有「被轮询时自动判超时」的惰性检查，route.ts 头注释）。
- c) 读取方在跑吗：功能在用：client_discovery_jobs 共 66 行，最近一条 2026-10-04 22:43 completed。
- d) 改变过决定吗：无（从未清理过任何一个任务；头注释提到的「12 小时孤儿」是历史事件）。
- 结论：**C**（兜底网，从未触发）；每天花费：≈ $0；建议：**改**——每小时 → 每天 1 次。

### prospecting-sweep （每小时整点，Render；14 天 336 次全失败）
- 写入：`outbound_prospects`（发现→审计→AI 分析→出邮件草稿，状态 audited/analyzed/outreach_ready/contacted）；外部：Google Places 搜索（发现）、AI 分析（单次约 $0.15）、**发送永远人工**（route.ts 头注释）。
- a) 最近运行：336 次**全 failed**，错误全部是 `Places text search: REQUEST_DENIED — You must enable Billing on the Google Cloud Project`；最近一次成功是 **2026-09-08 18:00 UTC**（发现 16 个、新增 0）；`outbound_prospects` 最新一行创建于 2026-09-08 08:00。也就是 **约 4 周没产出新线索**。报错路径：队列里 audit/analyze/draft 三步都排空后才会走 discover，discover 每次都被拒，所以每次整点都白失败。
- b) 读取方：后台页面 `src/app/dashboard/admin/prospecting/page.tsx`（PM 人审）、`src/app/api/admin/prospecting/*`（人工触发的同类接口）、公开报告页 `src/app/report/[id]/page.tsx` 与 `api/report/[id]/interest`（收件人点进去的报告）、退订页、`api/cron/job-boards-weekly`（另一条来源）。
- c) 读取方在跑吗：页面是人工页，没有别的定时任务读它。库里 3027 行：**outreach_ready（待人审）1452、audited 1028、contacted 129、analyzed 1，replied/onboarding/converted 全 0，`converted_client_id` 非空 0 行**。已发出的 129 封里 113 封在 07-07、16 封在 09-05（contacted_at 最近 2026-09-05 23:41）；自 09-05 起没人再发，**积压 1452 封待审草稿无人处理**。
- d) 改变过决定吗：发过 129 封外联（说明 PM 点过「通过并发送」），但回复/转化 0，没有证据显示它带来过任何一个客户。
- **失败有没有被发现**：每天 06:00 UTC 的 `daily-cron-digest` 邮件会列出（它的头注释 route.ts:59 记着「09-22 那封 80 行里 prospecting-sweep 占 25 行，Google 地图账单没开已连挂 505 次」，随后改成同原因合并一行）；09-16 的提交 2a17a85f2 也写了「Google Places Billing 未启用」并把频率从 */30 降到每小时，**说明早就知道，但 3 周没人修，也没人决定停**。今日待办里没有为它开卡（grep 没找到）。
- 结论：**B**（读取方是人工页面且有 1452 封积压没人看，上游全失败）；每天花费：Google Places ≈ $0（被拒绝不计费）；AI 分析已停（队列走不到 analyze 步）；历史累计 AI 分析成本约 1452 条 × $0.15 ≈ $218（按代码注释单价，没核对账单）；建议：**停**（PM 要么开 Google Cloud 账单，要么明说不做；现在是每天 24 次必败 + 每天一封「失败」邮件行噪音）；另需 PM 决定那 1452 封待审草稿怎么处理。

### demo-refresh-daily （GitHub Actions，每天 17:10 UTC；不在 render.yaml）
- 写入：演示客户 Harbourline Physio（`d0000000-…-000000000001`）的 `serp_rankings`、`ai_visibility_snapshots`、`goals`、`client_site_pages` 等（src/lib/demo/refresh.ts:55-118，先删后插，只动演示客户）。**不写 cron_run_logs**。
- a) 最近运行：GitHub 09-23 之后 13 次全 success；实际触发时间飘到 UTC 19:43–23:07（名义 17:10）；演示客户 ai_visibility_snapshots 最新 2026-10-05 23:07 与最近一次运行吻合，数据是新鲜的。
- b) 读取方：管理员演示账号登录后看到的各页面（与真实客户同一批页面）。
- c) 读取方在跑吗：页面在；但**有没有人真用演示账号**——无证据（库里没有演示账号登录/访问记录可查，也没有销售演示记录）。
- d) 改变过决定吗：无证据。
- 结论：**B**（数据是活的，没法证明有人在看）；每天花费：≈ $0（GitHub Actions 约 1 分钟 + 一次库写入）；建议：**保留**（成本为零，且演示用）；与 factory-sweepers 一样受 GitHub「尽力而为」影响，不影响演示用途。

---

## 汇总表

| 任务 | 结论 | 每天花费 | 建议 |
|---|---|---|---|
| vision-analyzer | B | ≈$0（14 天 0 张图） | 改：事件触发，别每小时空转 |
| poll-visual-jobs | B | ≈$0 | 停/改：近 80 天无人点生成 |
| viral-analyzer-worker | B（实质已坏） | Gemini $0（429 不扣费，免费档每天 20 次）；网站请求约 67 分钟/天 | **停+修**：队列头被永久失败行堵死、占光 Gemini 额度、疑似拖垮 AI 可见度 Google 探针（494 条失败 491 条） |
| viral-discovery-weekly | B | ≈$0（YouTube 免费配额） | 停到分析修好；之后降到每周 |
| content-factory-intake | C | 没法估（缺 Apify 账单） | 停（09-28 起抓取 0 条，错误被吞；139 条草稿 138 条没人动） |
| factory-publish-worker | A | ≈$0 | 保留（14 天真发 2 条草稿；仍是草稿模式） |
| factory-order-scheduler | C | $0 | 停/降到每周：全客户自动下单开关都关 |
| factory-publish-sweeper | C | ≈$0 | 改：并进 publish-worker，不单独占一个服务 |
| factory-worker-sweeper（GitHub） | A | ≈$0 | 改：名义 5 分钟实际约 5 次/天，要时效就搬 Render |
| factory-worker-alive（接口心跳） | A | $0 | 保留；清掉已离线的试验 worker 行 |
| winner-reel-sync-daily | B | ≈$0 | 改：结果要进待办/日报；GitHub 同名工作流仅手动，不重复调度 |
| tailor-made-jobs-sweeper | C | ≈$0 | 改：降到每天 1 次 |
| libai-prompt-library-monthly | B | $0 | 保留 |
| zhangqian-sweeper | C | ≈$0 | 改：降到每天 1 次 |
| prospecting-sweep | B（上游全失败） | Google $0（被拒）；历史 AI 分析约 $218 | **停**或开账单；3 周前就知道没修；1452 封待审草稿无人处理 |
| demo-refresh-daily（GitHub） | B | ≈$0 | 保留 |

A 3 条 / B 8 条 / C 5 条 / D 0 条（共 16）。
