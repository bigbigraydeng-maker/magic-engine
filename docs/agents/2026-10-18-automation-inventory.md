# ME 自动程序全量清单 · 2026-10-18 · 119 号

> **是什么**：系统里所有自动运行的程序（定时的 + 靠事件叫醒的）去重后的清单，每个挂到名单上的 Agent 名下，挂不上的单列；最关键的一列是「对外副作用」。
> **怎么来的**：PM 回「登记」。一次只读清点（不改任何程序）；判成会对外发话 / 花钱 / 改客户账户的 20 个，调研员都追到了真正调用外部接口的那一行，我又亲自核了最重的几个，并**查了正式库里这些开关现在开没开**（见下方「实际通电状态」）。
> **基线**：`origin/main` = `31f6d3e9e`（2026-10-18 22:26 新西兰时间）。
> **用途**：给开发窗口查「某个程序归谁、会不会对外动手」。**它是一次性快照，不是活清单**——会过时。真正不会过时的做法是在程序登记表里加一栏「归谁管」，让清单由系统自己生成，那一步要改代码，已列入问 PM 的清单。

---

## 实际通电状态（我亲自查的正式库，2026-10-18）

调研员只能说「代码里有这条路、受某个开关管」。开关在正式环境开没开，我查了能查到的：

| 程序 | 代码里的对外动作 | 正式库里实际状态 |
|---|---|---|
| 客人私信「自动安抚」`cloud-conversation-inbound-autoack`（**无主**） | 客人一来消息，不经人审自动发一句安抚话术 | **没通电**：`clients` 表里三个渠道开关（messenger / whatsapp / email）**所有客户全是关**，且读不到开关时按「关」处理（fail-closed） |
| 评论自动回复 `social-comment-autoreply`（苏东坡） | 公开回复、私信、隐藏垃圾评论 | **CTS 开着**（`enabled=true`，私信回复开）。近 30 天：2 条用大模型写的回复已发出，7 条失败、4 条挂起、5 条跳过；**私信回复 0 条发出** |
| 赢家 Reel 自动建广告 `winner-reel-sync-daily`（卫青，**不经过授权关卡**） | 把自然流量好的 Reel 建成广告，暂停疲劳的广告 | **CTS 开着**，但新广告默认建成**暂停**状态（`new_ad_default_status=PAUSED`），建出来不会自己花钱，要人去开。累计 84 次成功、19 次出错 |
| LinkedIn 自动发帖 ×2（**无主**） | 无人值守发到创始人的 LinkedIn | 环境变量开关，**我读不到**，未核 |
| 日计划自动发帖 / Story 发布（苏东坡） | 发 Facebook 帖子 / Story | 环境变量开关（`DAILY_PLAN_AUTO_PUBLISH_LIVE` / `STORY_AUTO_PUBLISH_LIVE`），**我读不到**，未核 |
| 工厂发片 `factory-publish-worker`（苏东坡） | 发 Reel；没设 `FACTORY_PUBLISH_LIVE=true` 时上传为不公开草稿（草稿也会进客户主页） | 同上，**读不到**，未核 |
| CTS 网站标题自动改 `cloud-seo-meta-cycle-run-one`（孔子） | 改客户网站代码仓库并**自动合并** | 受客户配置 `seo_config.meta_cycle_enabled` 管；**本次没查**。注意：9-28 支柱稿说 Oztop 每周自动改标题曾无闸，已暂停 |

> 读不到的是"环境变量"类开关（在 Render 后台，不在数据库）。要核，需要有人看 Render 后台设置——**我不去读 Render 的密钥**。

---

# Magic Engine 自动程序全量清单

**结论：两处清单去重后共 119 个自动程序，挂到名单上 Agent 名下的有 68 个，待定 4 个，平台维护 16 个，无主 31 个。** 有对外副作用的共 20 个：①对外发话或发布 9 个、②花钱或改广告 3 个、③改客户网站或账户 8 个。其中 7 个无主，1 个待定。

**依据：** 全程只读，没改文件、没提交、没推送。主干 `origin/main` 在 `31f6d3e9e`，2026-10-18 22:26 新西兰时间刚拉取；本分支 `74f36caec`，§4.4 名单取自本分支。

**怎么读这张表：**
- 文件路径缩写：`cron/X` 指 `src/app/api/cron/X/route.ts`，`fn/X` 指 `src/lib/inngest/functions/X.ts`。
- 定时时间：Render 和 GitHub 的定时都按 UTC；Inngest 定时注明 NZ 的按新西兰时间，没注明的按 UTC。
- 「付费」= 会花第三方调用费（大模型、DataForSEO、Apify、渲染等）。这类我都归在④，不算②。②只算「动广告或广告预算」。
- 给 ME 自己邮箱发的内部邮件算④，不算①。

## 1. 全量表

### 卫青（广告）· 8 个

| 程序名 | 定义文件 | 怎么叫醒 | 做什么 | 对外副作用 | Agent | 依据 |
|---|---|---|---|---|---|---|
| google-data-pullback-daily | cron/google-data-pullback-daily | Render 定时 `0 17 * * *`（登记表写 `0 3`，对不上） | 每天拉 GSC/GA4/Meta/Google Ads 数据，做广告体检和只读诊断，发广告日报；诊断成功后发 D3 事件 | ④ **待核**：日报收件人来自客户配置 `digest_recipients`，可能含客户邮箱 | 卫青 | §4.4 点名；route.ts:520、:559 `sendAdHealthDigest`；config.ts:148 |
| ad-entity-snapshot | cron/ad-entity-snapshot | Render `30 */6 * * *`（登记写 `*/3`） | 抓 Meta 广告设置快照，有变化才记 | ④ | 卫青 | 文件头写「只读 Meta」 |
| ad-readback-sweep | cron/ad-readback-sweep | Render `40 20 * * *` | 所有在投广告组过一遍上线闸门，发现的问题进今日待办 | ④ | 卫青 | 文件头；meta/readback.ts 只读 |
| winner-reel-sync-daily | cron/winner-reel-sync-daily | Render `0 15 * * *` | 把自然流量好的 Reel 建成广告，暂停疲劳的广告 | **②** | 卫青 | winner-reel-sync/engine.ts:277 `createAdFromPost`（新广告状态取客户配置，:283，可以是 ACTIVE）；:335 `pauseAd`；不经过内核 |
| cloud-ads-d3-auto-pause | fn/ads-d3-auto-pause | 事件 `ads.diagnostics.completed_for_client`（由 pullback 发出） | D3「花钱没结果」命中后提交内核等人批准；演练模式只记账 | ④ 只提交，真正暂停发生在人批准时 | 卫青 | 文件头 :20-21；:384 |
| cloud-ads-campaign-budget-decrease | fn/ads-campaign-budget | 事件 `ads.campaign_budget.decrease_requested`（人从 meta-ads/execute 接口发起） | 执行人发起的砍系列预算 | **②** | 卫青（执行这半按 §4.1 也像鲁班） | :50 → capabilities/ads/cut-campaign-budget.ts:93 `setCampaignDailyBudget` |
| cloud-ads-o1-budget-scale | fn/ads-o1-budget-scale | 事件 `ads.o1_budget_scale.approved`（人批准接口） | 执行人批准的加预算 | **②** | 卫青 | action-submission/ads-o1-budget-scale.ts:64 → capabilities/ads/scale-unit-budget.ts:185、:217 |
| cloud-ads-autonomy-sync | fn/ads-autonomy-sync | 事件 `ads.autonomy_mode.changed` | 把广告自治开关同步进内核的权限表 | ④ 只写我们的库，但它决定之后广告能不能自动动 | 卫青 | 文件头 :2-9 |

### 孔子（SEO）· 10 个

| 程序名 | 定义文件 | 怎么叫醒 | 做什么 | 对外副作用 | Agent | 依据 |
|---|---|---|---|---|---|---|
| seo-patrol-daily | cron/seo-patrol-daily | Render `0 4 * * *` | SEO 规则巡检，前 3 条写进执行看板 | ④ | 孔子 | §4.4；文件头 |
| seo-weekly-list | cron/seo-weekly-list | Render `30 4 * * 1` | 给有 GSC 点击目标的客户生成并核对每周 SEO 清单 | ④ | 孔子 | 文件头写「只写自己的表」 |
| cloud-seo-meta-cycle-fanout（登记名 seo-meta-cycle-step6-completed） | fn/seo-meta-cycle | Inngest 定时 `30 5 * * 1` | 给开了标题周循环的客户派单 | ④ | 孔子 | §4.4 |
| cloud-seo-meta-cycle-run-one | fn/seo-meta-cycle | 事件 `seo/meta-cycle.due` | 选页 → AI 写标题 → 改客户网站代码仓库并**自动合并** | **③** + 付费 | 孔子 | seo-meta/cycle/apply-adapter.ts:145-155 建分支、提交、开 PR；:241 `mergePullRequest` |
| cloud-seo-meta-rank-sampler-fanout | fn/seo-meta-rank-sampler | Inngest `20 20 * * *` | 找出到期要测排名的改动 | ④ | 孔子 | 文件头 |
| cloud-seo-meta-rank-sampler-one | fn/seo-meta-rank-sampler | 事件 `seo/meta-rank.sample.due` | 每条最多一次付费排名查询 | ④ 付费 | 孔子 | 文件头 |
| oztop-seo-optimizer | cron/oztop-seo-optimizer | Render `0 5 * * 1` | AI 给 Oztop 写新标题和摘要，写进待改队列；客户 WordPress 插件每小时拉取并改到网站上 | **③** 间接：我们写队列，客户站插件自动生效 | 孔子 | 文件头 :6-11；:200 写入 `seo_meta_log` |
| cts-seo-optimizer（已退役） | cron/cts-seo-optimizer | 不排班，被调用就返回 410 | 不做事 | ④ | 孔子 | 文件头 :2-11 |
| cloud-seo-post-publish-fanout | fn/seo-post-publish-monitor | 事件 `seo/page-watch.started` | 派发 T+72 小时、T+7 天两次检查 | ④ | 孔子 | **全仓没有发这个事件的代码** |
| cloud-seo-post-publish-check | fn/seo-post-publish-monitor | 事件 `seo/page-watch.check_due` | 检查单页 | ④ | 孔子 | 同上，上游断了 |

### 孟子（AI 可见度）· 5 个

| 程序名 | 定义文件 | 怎么叫醒 | 做什么 | 对外副作用 | Agent | 依据 |
|---|---|---|---|---|---|---|
| ai-tracker-weekly | cron/ai-tracker-weekly | Render `0 18 * * 0`（登记写 `0 1 * * 1`） | 旧链路：给没开新开关的客户跑 AI 可见度追踪 | ④ 付费 | 孟子 | §4.4；文件头 |
| industry-ai-visibility-daily | cron/ai-visibility-weekly | Render `30 16 * * 1`（每周一次，名字却叫 daily） | 行业问题在 ChatGPT、谷歌 AI 摘要、搜索结果里的品牌出现率 | ④ 付费 | 孟子（属于采集，按 §4.1 也可算张骞） | 文件头 |
| cloud-ai-visibility-weekly-fanout（登记名 ai-visibility-tracker-weekly） | fn/ai-visibility-weekly | Inngest 定时，NZ 周一 06:00 | 派单 | ④ | 孟子 | 文件头 |
| cloud-ai-visibility-tracker-run-one | fn/ai-visibility-weekly | 事件 `ai-visibility/tracker.due` | 跑一个客户的追踪 | ④ 付费 | 孟子 | 文件头 |
| cloud-geo-remeasure-one | fn/geo-remeasure | 事件 `geo/remeasure.due`（**全仓没人发**） | 只是骨架，不真调外部服务 | ④ | 孟子 | 文件头 :3-8 |

### 苏东坡（社媒/内容）· 19 个

| 程序名 | 定义文件 | 怎么叫醒 | 做什么 | 对外副作用 | Agent | 依据 |
|---|---|---|---|---|---|---|
| content-factory-intake | cron/content-factory-intake | Render `0 22 * * *` | 开了自动进料的客户：抓爆款 → 改写 → 写候选 | ④ 付费（Apify + 大模型） | 苏东坡 | 文件头 |
| factory-order-scheduler | cron/factory-order-scheduler | Render `0 20 * * *` | 给开了自动下单的客户每天下一单 | ④ 会触发付费生成，每单封顶 $2 | 苏东坡 | 文件头 :4-5 |
| factory-publish-worker | cron/factory-publish-worker | Render `5 * * * *` | 把审过的成片发到客户 FB Reel、IG（经 Publer）、TikTok；顺带发讲课片 | **①** 默认是草稿：没设 `FACTORY_PUBLISH_LIVE=true` 时上传成不公开草稿，但草稿也写进了客户主页 | 苏东坡 | route.ts:29-31；factory/publish/publish-worker.ts:283 `adapter.publish` |
| poll-visual-jobs | cron/poll-visual-jobs | Render `15 * * * *` | 查图片、视频、数字人生成任务的进度，成品转存，失败排重试 | ④ | 苏东坡 | 文件没有头注释；只调各家「查状态」接口 |
| cloud-factory-creatomate-render（登记名 creatomate-render） | fn/factory-creatomate-render | 事件 `me/factory.creatomate_render.requested`（内容「确认」按钮） | 渲染成片，完成后通知马良 | ④ 付费 | 苏东坡 | :357 |
| cloud-reel-batch-render | fn/reel-batch-render | 事件 `reel/batch.render.started`（reel-batch/start 接口） | 先渲小样 → 等 PM 批 → 渲全尺寸 → 入库 | ④ 付费 | 苏东坡 | 文件头 |
| viral-discovery-weekly | cron/viral-discovery-weekly | Render `0 0 * * *`（每天跑，名字叫 weekly） | 按行业搜 YouTube 爆款入库 | ④ | 苏东坡（爆款配方库，也可算张骞） | 文件头 |
| viral-analyzer-worker | cron/viral-analyzer-worker | Render `*/10 * * * *` | 用 Gemini 分析爆款 | ④ 付费 | 苏东坡 | 文件头 |
| social-comment-autoreply | cron/social-comment-autoreply | Render `0 * * * *`（登记写 `*/30`） | 拉客户 FB 主页评论，自动公开回复、私信、隐藏垃圾评论 | **①** | 苏东坡 | social/comment-autoreply-engine.ts:363 `hideComment`、:381 `sendPrivateReply`、:388 `replyToComment`；按客户开关，全局急停 `SOCIAL_COMMENT_AUTOREPLY_KILL` |
| social-engagement-pullback | cron/social-engagement-pullback | Render `0 4 * * *` | 拉 Publer 帖子互动和 TikTok 主页数据 | ④ | 苏东坡 | 文件头 |
| cloud-daily-plan-auto-publish | fn/daily-plan-auto-publish | **Inngest 定时**，NZ 每小时第 20 分 | 每日计划的图文帖自动发 Facebook | **①** 默认演练：`DAILY_PLAN_AUTO_PUBLISH_LIVE` 打开且有授权才真发 | 苏东坡 | campaign/daily-plan-publish-effects.ts:129 `publishPagePhotoPost`；daily-plan-auto-publish-deps.ts:110 |
| cloud-story-lite-publish | fn/story-lite-publish | Inngest 定时，NZ 每 10 分钟 | 发 FB Story | **①** 默认演练：`STORY_AUTO_PUBLISH_LIVE=true` 且客户在名单上才发 | 苏东坡 | social/story-lite/ports.ts:69、:79-80 |
| cloud-daily-plan-post-story-resolve | fn/daily-plan-post-story-resolve | 事件 `daily_plan.post.story_resolve_due`（发布器发） | 排期照片上线后取帖子编号、发测量事件；**还会在帖子下发第一条评论** | **①** | 苏东坡 | :176-185 `post-first-comment` 步骤 → meta/first-comment |
| cloud-daily-plan-post-fanout | fn/daily-plan-post-measurement | 事件 `daily_plan.post.published` | 登记发布动作，派发 T+4、T+72 小时测量 | ④ | 苏东坡 | 文件头 |
| cloud-daily-plan-post-measure | fn/daily-plan-post-measurement | 事件 `daily_plan.post.measure_due` | 读帖子表现，写回执 | ④ | 苏东坡 | 文件头 |
| cloud-factory-reel-measurement-adapter | fn/factory-reel-measurement-adapter | 事件 `me/factory.reel.published` | 把工厂 Reel 接进同一套测量 | ④ | 苏东坡 | 文件头 |
| cloud-youtube-staging | fn/youtube-publish | 事件 `youtube.staging.requested`（youtube/stage 接口） | 把审过的视频**私密**上传到客户 YouTube 频道 | **③** 私密或不公开，外人看不到 | 苏东坡 | youtube-publish/client.ts:102-116 |
| cloud-youtube-public-step | fn/youtube-publish | 事件 `youtube.public.authorized` | 「改成公开」这一步，代码写死只演练 | ④ | 苏东坡 | youtube-publish/workflow.ts:148 写死演练模式 |
| factory-stock-refill（暂停） | cron/factory-stock-refill | 不排班（2026-09-08 PM 叫停） | 给素材池抓图 | ④ 付费（Apify） | 苏东坡 | 不排班清单 |

### 司马迁（口碑）· 2 个

| 程序名 | 定义文件 | 怎么叫醒 | 做什么 | 对外副作用 | Agent | 依据 |
|---|---|---|---|---|---|---|
| reputation-snapshots-weekly | cron/reputation-snapshots-weekly | Render `30 3 * * 1` | 抓 GBP 和 Tripadvisor 的评分与新评价 | ④ 付费（DataForSEO） | 司马迁（采集，也可算张骞） | 文件头；喂给下面这个 |
| cloud-simaqian-reputation-weekly | fn/simaqian-reputation-weekly | Inngest 定时，NZ 周四 09:00 | 读新评价，起草回复和好评帖，进今日待办，一律不发 | ④ 付费（大模型） | 司马迁 | 文件头写 `no_publish` |

### 张骞（采集）· 14 个

| 程序名 | 定义文件 | 怎么叫醒 | 做什么 | 对外副作用 | Agent | 依据 |
|---|---|---|---|---|---|---|
| keyword-snapshots-weekly | cron/keyword-snapshots-weekly | Render `0 2 * * 1` | 关键词排名快照和搜索结果页抓取 | ④ 付费 | 张骞 | §4.1「关键词数据新鲜」 |
| site-audit-weekly | cron/site-audit-weekly | Render `0 1 * * 0` | 重新爬重点客户的网站 | ④ 只读客户网站 | 张骞 | 文件头 |
| cloud-flywheel-seo-weekly-fanout（登记名 flywheel-seo-weekly） | fn/flywheel-seo-weekly | Inngest 定时，NZ 周一 05:15 | 派单 | ④ | 张骞 | 文件头 |
| cloud-flywheel-seo-snapshot-one | fn/flywheel-seo-weekly | 事件 `flywheel/seo.snapshot.due` | 一个客户的 SEO 快照 | ④ 付费 | 张骞 | 文件头 |
| cloud-gsc-page-daily-fanout（登记名 gsc-page-daily） | fn/gsc-page-daily | Inngest `30 18 * * *` | 派单 | ④ | 张骞 | 文件头 |
| cloud-gsc-page-daily-pull | fn/gsc-page-daily | 事件（登记表却写了定时周期） | 拉每页每天的 GSC 数据 | ④ | 张骞 | :348 |
| cloud-gsc-query-page-daily-fanout（登记名 gsc-query-page-daily） | fn/gsc-query-page-daily | Inngest `0 19 * * *` | 派单 | ④ | 张骞 | 文件头 |
| cloud-gsc-query-page-daily-pull | fn/gsc-query-page-daily | 事件（登记表写了定时周期） | 拉「搜索词 × 页面」每日数据 | ④ | 张骞 | 文件头 |
| cloud-competitor-watch-weekly-fanout（登记名 competitor-watch-weekly） | fn/competitor-watch-weekly | Inngest 定时，NZ 周一 05:45 | 派单 | ④ | 张骞 | §4.1「竞品监控归张骞」 |
| cloud-competitor-watch-run-one | fn/competitor-watch-weekly | 事件 `competitor/watch.due` | 一个客户的竞品快照 | ④ 付费 | 张骞 | 文件头 |
| cloud-web-intelligence-due | fn/web-intelligence | Inngest 定时，NZ 每天 06:00 | 派发竞品网页抓取；没设允许客户名单就不跑 | ④ | 张骞 | :40-55 |
| cloud-web-intelligence-capture | fn/web-intelligence | 事件 `web_intelligence.website.capture.requested` | 抓竞品网页 | ④ 付费（Apify） | 张骞 | :12-38 |
| cloud-web-intelligence-traffic-due | fn/web-intelligence | Inngest 定时，NZ 每月 1 日 03:00 | 竞品流量估算，默认关 | ④ 付费 | 张骞 | :61-90 |
| baseline-domains-monthly | cron/baseline-domains-monthly | Render 后台手工建的定时 `0 17 * * 0`（仓库里看不到） | 采集基准域名的 SEO 数据，写行业基准 | ④ 付费 | 张骞 | 文件头 |

### 华佗（处方）· 2 个

| 程序名 | 定义文件 | 怎么叫醒 | 做什么 | 对外副作用 | Agent | 依据 |
|---|---|---|---|---|---|---|
| diagnostic-weekly | cron/diagnostic-weekly | Render `0 8 * * 1` | 六维深度诊断 | ④ 付费 | 华佗 | §4.4：六维打分在 diagnostic/runner.ts |
| prescription-weekly | cron/prescription-weekly | Render `0 8 * * 2` | 自动开处方，直接落进执行看板 | ④ 付费 | 华佗 | 文件头 |

### 鲁班（执行助手）· 1 个

| 程序名 | 定义文件 | 怎么叫醒 | 做什么 | 对外副作用 | Agent | 依据 |
|---|---|---|---|---|---|---|
| execution-auto-run（暂停） | cron/execution-auto-run | 不排班（2026-10-07 叫停） | 把看板上的动作写成草稿 | ④ | 鲁班 | 文件头写「不发布、不碰客户网站」 |

### 马良（出片检查）· 2 个

| 程序名 | 定义文件 | 怎么叫醒 | 做什么 | 对外副作用 | Agent | 依据 |
|---|---|---|---|---|---|---|
| vision-analyzer | cron/vision-analyzer | Render `50 * * * *` | 用 GPT-4o-mini 给客户素材打分 | ④ 付费 | 马良 | §4.4 |
| cloud-maliang-render-check（登记名 maliang-render-check） | fn/maliang-render-check | 事件 `me/maliang.render.ready` | 成片 9 宫格自检，不过关标返工 | ④ 付费 | 马良 | 文件头 |

### 李白（文案）· 3 个

| 程序名 | 定义文件 | 怎么叫醒 | 做什么 | 对外副作用 | Agent | 依据 |
|---|---|---|---|---|---|---|
| blog-weekly | cron/blog-weekly | Render `0 3 * * 2` | 每客户每周一篇博客草稿，从不发布 | ④ 付费 | 李白（也可算孔子） | §4.4：李白入口是 lib/blog |
| cloud-libai-copy-provenance（登记名 libai-copy-provenance） | fn/libai-copy-provenance | 事件 `me/libai.copy.generated` | 逐句标出文案的出处 | ④ 付费 | 李白 | 文件头 |
| cloud-libai-prompt-library-monthly | fn/libai-prompt-library-monthly | Inngest 定时，NZ 周二 09:00（函数里再判是不是月初第一周） | 提示词库体检，只报告不改 | ④ | 李白 | 文件头 |

### 诸葛亮（统筹）· 2 个

| 程序名 | 定义文件 | 怎么叫醒 | 做什么 | 对外副作用 | Agent | 依据 |
|---|---|---|---|---|---|---|
| zhuge-weekly-recalculate | cron/zhuge-recalculate | Render `0 3 * * 1` | 每周重算优先动作，写进看板 | ④ 付费 | 诸葛亮 | §4.4 |
| anomaly-detector-daily | cron/anomaly-detector | Render `0 5 * * *` | 规则找异常，再由诸葛亮 AI 判断要不要建任务 | ④ 付费 | 诸葛亮 | 文件头 |

### 待定 · 4 个

| 程序名 | 定义文件 | 怎么叫醒 | 做什么 | 对外副作用 | Agent | 依据 |
|---|---|---|---|---|---|---|
| goal-current-value-refresh | cron/goal-current-value-refresh | Render `30 17 * * *`（登记写 `0 3`） | 刷新所有进行中目标的当前值 | ④ 付费 | 待定（诸葛亮候选） | 名单里没人管目标 |
| goals-expiry-check | cron/goals-expiry-check | GitHub 定时 `30 3 * * *` | 标出过期目标，自动续上下个月的月度目标 | ④ | 待定（诸葛亮或平台维护） | 文件头 |
| cloud-promo-plan-daily-watch | fn/promo-plan-daily-watch | Inngest 定时，NZ 07:10 | 推广计划每日检查，只读 | ④ | 待定（卫青或诸葛亮） | 推广计划板块就是广告总管理 |
| cloud-conversion-daily-pipeline | fn/conversion-daily-pipeline | Inngest 定时，NZ 06:00 | 同步 NAL 私信、CTS 表格里的成交，AI 审核后回传给 Meta | **③** | 待定（卫青候选，它喂广告优化；也是客户关系管理那条线） | :404、:412 → meta/capi/writer.ts:275 向客户的 Meta 像素写转化 |

### 平台维护 · 16 个

| 程序名 | 定义文件 | 怎么叫醒 | 做什么 | 对外副作用 | Agent | 依据 |
|---|---|---|---|---|---|---|
| cron-run-logs-cleanup | cron/cron-run-logs-cleanup | Render `50 16 * * *` | 清理旧的运行记录 | ④ | 平台维护 | 文件头 |
| daily-cron-digest | cron/daily-cron-digest | Render `0 6 * * *` | 定时任务失败摘要 | ④ 发 ME 内部邮件 | 平台维护 | 收件人固定为 ME 邮箱 |
| pm-daily-todo | cron/pm-daily-todo | Render `0 19 * * 0-4` | 今日待办邮件 | ④ 发 ME 内部邮件 | 平台维护 | route.ts:66 |
| weekly-seo-report | cron/weekly-seo-report | Render `30 18 * * 0` | PM 每周巡查报告 | ④ 发 ME 内部邮件 | 平台维护 | route.ts:70 |
| product-map-sync | cron/product-map-sync | Render `15 18 * * *` | ME 产品地图每日对账，只读我们自己的代码仓库 | ④ | 平台维护 | github-rest-provider.ts 文件头写「只读」 |
| cms-connection-retest | cron/cms-connection-retest | Render `10 6 * * *` | 重测已经坏了的发布通道（WordPress 只做读取测试） | ④ | 平台维护 | wordpress-client.ts:428 |
| blog-stuck-generating-sweeper | cron/blog-stuck-generating | Render `45 * * * *` | 把卡住的博客生成任务标成失败 | ④ | 平台维护 | 文件头 |
| tailor-made-jobs-sweeper | cron/tailor-made-jobs-sweeper | Render `*/30 * * * *` | 把卡住的定制行程任务标成失败 | ④ | 平台维护 | 文件头 |
| zhangqian-sweeper | cron/zhangqian-sweeper | Render `35 * * * *` | 把卡住的张骞任务标成失败 | ④ | 平台维护 | 文件头 |
| factory-publish-sweeper | cron/factory-publish-sweeper | Render `25 * * * *` | 把卡住的发布工单退回「已批准」 | ④ 下一轮发布程序会重新处理它 | 平台维护 | 文件头 |
| site-audit-cron | cron/site-audit-jobs | Render `0 2 * * *` | 网站审计任务的清理和续跑 | ④ | 平台维护 | 文件头 |
| playbook-staleness-weekly | cron/playbook-staleness-weekly | 本机 Claude 定时任务 `30 8 * * 1` | 接收经验手册「疑似过期」的核对结果并入库 | ④ | 平台维护 | 文件头 |
| cloud-calendar-closure-audit | fn/calendar-closure-audit | Inngest 定时，NZ 07:20 | 日历到期验证事项巡检，只读 | ④ | 平台维护 | 文件头 |
| cloud-conversation-health-heartbeat | fn/conversation-health-heartbeat | Inngest `7 */6 * * *` | 查私信客服系统有没有悄悄停摆 | ④ | 平台维护 | 文件头 |
| cloud-probe-ping-receipt | fn/probe | 事件 `cloud/probe.ping` | 测试探针，什么都不做 | ④ | 平台维护 | 文件头 |
| team-memory-sweeper（暂停） | cron/team-memory-sweeper | 不排班（2026-10-07 叫停） | 补提炼团队记忆 | ④ 付费 | 平台维护 | 不排班清单 |

### 无主 · 31 个

| 程序名 | 定义文件 | 怎么叫醒 | 做什么 | 对外副作用 | Agent | 依据 |
|---|---|---|---|---|---|---|
| linkedin-progress-post-mon | cron/linkedin-progress-post-mon | Render `30 20 * * 0` | 把本周上线内容写成英文帖，**无人值守**发到创始人的 LinkedIn | **①** | 无主（ME 自家宣传） | linkedin-progress/run.ts:216 经 Publer 发出；开关 `LINKEDIN_PROGRESS_POST_ENABLED` |
| linkedin-progress-post-thu | cron/linkedin-progress-post-thu | Render `30 20 * * 3` | 同上，周四那一半 | **①** | 无主 | 同上 |
| proposal-view-digest | cron/proposal-view-digest | Render `0 19 * * *` | 谁打开了 ME 销售方案的摘要 | ④ 发 hello@ 内部邮件 | 无主（ME 自己的销售） | 文件头 |
| prospecting-sweep | cron/prospecting-sweep | Render `0 * * * *`（登记写 `*/30`） | ME 自己获客：审站、分析、起草外联邮件草稿，发送全靠人 | ④ 付费 | 无主 | 文件头；开关 `PROSPECTING_SWEEP_ENABLED` |
| job-boards-weekly（暂停） | cron/job-boards-weekly | 不排班 | 从招聘信息里找获客线索 | ④ 付费 | 无主 | 文件头 |
| market-intel-daily | cron/market-intel-daily | Render `0 18 * * *` | 行业资讯汇总发 ME 邮箱 | ④ 内部邮件 | 无主 | market-intel/pipeline.ts:291、:315；路由文件没有头注释 |
| messenger-sync-hourly | cron/messenger-sync-hourly | Render `10 * * * *` | 把 FB 私信和邮箱里的客人消息拉进 CRM | ④ **间接**：邮箱那段会叫醒下面的自动安抚回复 | 无主 | microsoft/mail-ingest.ts:534 |
| cloud-messenger-brief-after-sync（登记名 messenger-brief-hourly） | fn/messenger-brief-after-sync | 事件 `me/messenger.sync.completed` | 写客户需求卡 | ④ 付费 | 无主 | 文件头 |
| mailbox-sync | cron/mailbox-sync | 不排班，只手动触发 | 邮箱同步 | ④ 间接，同 messenger-sync | 无主 | 不排班清单 |
| email-reply-digest（暂停） | cron/email-reply-digest | 不排班 | 「客人来信没回」汇总；收件人为空，退回 ME 邮箱 | ④ | 无主 | 文件头 |
| meta-leads-sync | cron/meta-leads-sync | Render `25 */2 * * *`（登记写 `25 * * * *`） | FB 表单线索进 CRM，并**订阅进客户的 Mailchimp 名单** | **③** | 无主 | crm/meta-lead.ts:408 → mailchimp/client.ts:369 |
| mailchimp-activity-sync | cron/mailchimp-activity-sync | Render `40 4 * * *` | 把邮件打开和点击搬进 CRM | ④ | 无主 | mailchimp/sync.ts 只读 |
| mailchimp-paid-tagging | cron/mailchimp-paid-tagging | Render `10 5 * * *` | 在客户 Mailchimp 里给已付款的人打付款标签、摘掉线索标签 | **③** | 无主 | mailchimp/paid-tagging.ts:253 |
| mailchimp-suppression-sync | cron/mailchimp-suppression-sync | Render `20 5 * * *` | 给「别再联系」的人打禁发标签 | **③** | 无主 | mailchimp/suppression-sync.ts:95 |
| cloud-lead-sheet-sync-fanout（登记名 lead-sheet-sync） | fn/lead-sheet-sync | Inngest 定时，NZ 每小时第 20 分 | 派单 | ④ | 无主 | 文件头 |
| cloud-lead-sheet-sync-one | fn/lead-sheet-sync | 事件 `lead_sheet/sync.due` | 把线索追加写进**客户指定的 Google 表格** | **③** | 无主 | lead-sheets/sync.ts:276 → google-sheets/client.ts:169 |
| cloud-crm-lead-followup-digest | fn/crm-lead-followup-digest | Inngest 定时，NZ 08:00 | 「客人填了表还没人回」汇总信；收件人写死在代码里只发 ME，默认不发 | ④ | 无主 | 文件头 :28-40 |
| cloud-conversation-inbound-autoack | fn/conversation-inbound-autoack | 事件 `conversation/message.received`（Messenger、WhatsApp 推送和邮箱同步都会发） | 客人一来消息，**不经人审**自动发一句安抚话术 | **①** | 无主 | :370 → messenger-agent/channel-dispatch.ts:57-60；渠道开关查不到就按关处理 |
| cloud-conversation-inbound-draft | fn/conversation-inbound-draft | 同上事件 | AI 起草回复，人在门户批准后才发出 | **①**（有人审） | 无主 | :726 |
| cloud-knowledge-mining-requested | fn/knowledge-mining | 事件 `knowledge/mining.requested`（**全仓没人发**） | 从对话里提炼知识 | ④ 付费 | 无主 | 文件头 |
| cloud-telephony-voipline-process | fn/telephony-voipline | 事件 `telephony.call.raw_event.received`（VoIPLine、Twilio 推送） | 通话写进 CRM | ④ | 无主 | 文件头写「无对客外发」 |
| cloud-telephony-voipline-sweep | fn/telephony-voipline | Inngest `*/10 * * * *` | 漏处理的通话补一轮 | ④ | 无主 | 同上 |
| cloud-telephony-call-analysis | fn/telephony-analysis | 事件 `telephony.call.recording.ready` | 录音转文字再分析，开关默认关 | ④ 付费 | 无主 | 文件头 |
| cloud-telephony-call-analysis-sweep | fn/telephony-analysis | Inngest `*/10 * * * *` | 补发上面的分析事件 | ④ | 无主 | :81-87 |
| cloud-tools-lab-lead-followup | fn/tools-lab-lead-followup | 事件 `tools_lab/lead.captured` | 只留一条回执 | ④ | 无主 | 文件头 |
| cloud-tools-lab-report-email-receipt | fn/tools-lab-lead-followup | 事件 `tools_lab/report_email.attempted` | 只留回执；发信本身在 public/site-check/report 接口里 | ④ | 无主 | 文件头 |
| attribution-cron | cron/attribution | Render `0 */6 * * *` | 算每个动作的效果 | ④ | 无主（「记性」这一层名单上没人管） | 文件头 |
| memory-extractor | cron/memory-extractor | Render `30 6 * * *` | 从效果里抽出记忆 | ④ | 无主（记性层） | 文件头 |
| agent-learning-rollup | cron/agent-learning-rollup | Render `0 7 * * 1` | 每周学习汇总 | ④ | 无主（记性层） | 文件头 |
| kpi-backfill | cron/kpi-backfill | Render `20 6 * * *` | 处方批准后 30、60、90 天回填 KPI | ④ 付费 | 无主（记性层） | 见第 3 节 |
| benchmark-accumulator | cron/benchmark-accumulator | Render `40 7 * * 1` | 用自有客户的真实结果累积行业基准 | ④ | 无主（记性层） | 文件头 |

## 2. 汇总

- **总数（去重后）：119 个。**
  - 定时登记表 73 条、不排班清单 10 条、Inngest 函数 56 个。
  - 有 20 个两边都登记了，各合并成一行：定时登记表里 17 条本身就是 Inngest 函数，不排班清单里 3 条也是 Inngest 函数。
- **每个 Agent 名下几个：**

| Agent | 个数 |
|---|---|
| 卫青 | 8 |
| 孔子 | 10 |
| 孟子 | 5 |
| 苏东坡 | 19 |
| 司马迁 | 2 |
| 张骞 | 14 |
| 华佗 | 2 |
| 鲁班 | 1（还是暂停的） |
| 马良 | 2 |
| 李白 | 3 |
| 诸葛亮 | 2 |
| 孙子 | 0 |
| 待定 | 4 |
| 平台维护 | 16 |
| 无主 | 31 |

- **①对外发话或发布：9 个**
  - factory-publish-worker
  - social-comment-autoreply
  - cloud-daily-plan-auto-publish
  - cloud-story-lite-publish
  - cloud-daily-plan-post-story-resolve
  - cloud-conversation-inbound-autoack
  - cloud-conversation-inbound-draft
  - linkedin-progress-post-mon
  - linkedin-progress-post-thu
- **②花钱或改广告：3 个**
  - winner-reel-sync-daily
  - cloud-ads-campaign-budget-decrease
  - cloud-ads-o1-budget-scale
- **③改客户网站或账户：8 个**
  - cloud-seo-meta-cycle-run-one
  - oztop-seo-optimizer
  - meta-leads-sync
  - mailchimp-paid-tagging
  - mailchimp-suppression-sync
  - cloud-lead-sheet-sync-one
  - cloud-conversion-daily-pipeline
  - cloud-youtube-staging
- **待核 1 个：** google-data-pullback-daily 的广告日报收件人，要查生产配置才知道有没有客户邮箱。
- **无主：31 个。**

## 3. 发现的问题

**第一件事：7 个有对外副作用的程序没人管。**
- ① 发话：autoack（不经人审直接回客人）、draft、两条 LinkedIn。
- ③ 改客户账户：meta-leads-sync、mailchimp-paid-tagging、mailchimp-suppression-sync、lead-sheet-sync-one。
- 另外 conversion-daily-pipeline（③，往客户 Meta 写转化）还是待定。
- 整条客户关系管理线（私信、邮箱、电话、Mailchimp、线索表格）在名单上没有对应的人。

**第二件事：有一个程序绕过内核改广告。**
- winner-reel-sync-daily 直接调 Meta 建广告、停广告（engine.ts:277、:335）。
- 新广告是不是一建就投放，取决于客户配置（:283 可设成 ACTIVE）。
- 它不走 §4.1 卫青「信封内才许自动动」那套内核规则。

**第三件事：有几处注释说的和代码做的不一样。**
- daily-plan-post-story-resolve：文件头只写了取帖子编号和发测量事件，代码 :176-185 还会在客户的 Facebook 帖子下**公开发第一条评论**。
- kpi-backfill：文件头写拉 SEMrush，代码实际调的是 DataForSEO（case-library/outcome-recorder.ts:14、:211）。
- seo-meta/cts-meta-pr.ts：文件头写「PM 合并」，现在跑的 apply-adapter.ts:241 是自动合并到 CTS 网站仓库。
- **§4.4 本身写错一处**：说 `dailyPlanAutoPublish` 是「事件函数」，实际是每小时定时（daily-plan-auto-publish.ts:44）。
- 文件头写的频率和实际排班对不上：

| 程序 | 文件头写 | 实际 |
|---|---|---|
| ai-visibility-weekly 路由 | 每天 02:30 UTC | 每周一 16:30（`30 16 * * 1`），登记名却叫 daily |
| blog-stuck-generating | 每 5 分钟 | 每小时一次 |
| zhangqian-sweeper | 每 5 分钟 | 每小时一次 |
| vision-analyzer | 每 2 分钟 | 每小时一次 |
| viral-analyzer-worker | 每 2 分钟 | 每 10 分钟 |
| viral-discovery-weekly | 名字叫每周 | 每天 |
| goal-current-value-refresh | 03:00 UTC | 17:30 UTC |
| google-data-pullback-daily | 3am UTC | 17:00 UTC |

- poll-visual-jobs、market-intel-daily 两个路由文件没有任何头注释。

**第四件事：登记表的周期和 render.yaml 实际排班有 7 条对不上。**

| 程序 | 登记表 | render.yaml |
|---|---|---|
| ad-entity-snapshot | `*/3` | `*/6` |
| ai-tracker-weekly | `0 1 * * 1` | `0 18 * * 0` |
| goal-current-value-refresh | `0 3` | `30 17` |
| google-data-pullback-daily | `0 3` | `0 17` |
| meta-leads-hourly | 每小时 | 每 2 小时 |
| prospecting-sweep | `*/30` | 每小时 |
| social-comment-autoreply | `*/30` | 每小时 |

另外 gsc-page-daily-pull、gsc-query-page-daily-pull 在登记表里写了定时周期，实际是靠事件叫醒的。

**第五件事：有 3 个函数注册了但永远叫不醒。**
全仓没有任何代码发它们要等的事件：cloud-knowledge-mining-requested、cloud-geo-remeasure-one、cloud-seo-post-publish-fanout（它下游的 check 也就跟着断了）。

**第六件事：有在跑的程序两份清单都没登记。**
- demo-refresh：GitHub 定时每天 `10 17 * * *`，刷新演示客户数据。
- factory-worker-sweeper：GitHub 定时每 5 分钟。
- factory-review-sweeper、admin-key-expiry 有路由文件，但没找到任何排班。
- seo-meta-cycle-trigger、flywheel-seo-weekly、messenger-brief-hourly、calendar-closure-audit 这 4 个路由是手动补跑入口，属于正常。

**第七件事：没发现「登记了但文件不存在」的情况。**
73 条定时登记和 10 条不排班登记都能对上真实文件。baseline-domains-monthly（Render 后台手建）和 playbook-staleness-weekly（本机 Claude 定时任务）的排班在仓库外，仓库里没法审查。

**第八件事：鲁班名下没有一个在跑的定时程序。**
已批准广告动作的真正执行，挂在卫青的两个预算函数里，经内核去做。

## 4. 我读了什么，没读到什么

**读全了的：**
- 主干上的 `src/lib/cron/registry.ts`（全文，含不排班清单）和 `src/lib/inngest/functions/index.ts`。
- `render.yaml` 的全部定时服务、`.github/workflows` 里所有带定时的工作流。
- §4.1（主干）和 §4.4（本分支）。

**每个程序读到的程度：**
- 71 个定时路由和 42 个 Inngest 函数文件，每个都读了文件头（约前 25-45 行）、触发配置和用到的事件名或定时常量。
- 每个程序都用一个小脚本算了它会用到哪些代码文件，再和「会往外部写东西」的 119 个文件对了一遍。
- 判成①②③的 20 个，都追到了真正调用外部接口的那一行，见表里的依据列。

**没读全的：**
- 大部分程序的主逻辑只看了文件头和关键调用，没逐行读。判成④的，依据是「用到的代码里没有往外写的函数，或者文件头明说只读」。
- google-data-pullback-daily 有 1222 行，只读了头注释和发日报、发事件的那几段。
- conversion-daily-pipeline、conversation-inbound-draft 的开关在生产上开没开，没查（需要读生产库，没有做）。
- 各程序的开关在生产上是什么状态都没查，包括 FACTORY_PUBLISH_LIVE、DAILY_PLAN_AUTO_PUBLISH_LIVE、STORY_AUTO_PUBLISH_LIVE、LINKEDIN_PROGRESS_POST_ENABLED、客户的 new_ad_default_status 和 social_comment_config.enabled。所以「会不会真发出去」只能说到「代码里有这条路、受这个开关管」。
- 「付费」标注只在明确用到大模型、DataForSEO、Apify、渲染、转写服务时才标；product-map-sync、market-intel-daily 有没有调大模型没核，所以没标。

---

## 附：我对清点结果的两处更正

1. **名单 §4.4 里我之前写错一处**：说 `dailyPlanAutoPublish` 是「事件函数」，实际是每小时定时（新西兰时间每小时第 20 分）。已在 `docs/specs/2026-09-24-agent-autonomy-operating-plan-v1.md` §4.4 改正。
2. 清点里「会花钱」的标注只在明确用到大模型 / 第三方数据 / 渲染时才标；有几个（如 `product-map-sync`、`market-intel-daily`）有没有调大模型没核，没标。
