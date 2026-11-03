# G1 组审计：广告回读 / 线索 / 私信 / 社媒互动 / 归因 / Mailchimp / KPI / LinkedIn（19 项）

数据口径：`logs14.json`（cron_run_logs 近 14 天，部分任务另用 SELECT 拉到 9/23 至今或全历史）；生产库只读 SELECT 于 2026-10-07 做。时间都是 UTC。
repo 路径均相对 `/Users/raydeng/Projects/magic-engine/.claude/worktrees/nifty-sanderson-f7ce97`。

## 链路总图（谁触发谁）

- Render 定时 `messenger-hourly`(10 * * * *) → `src/app/api/cron/messenger-sync-hourly/route.ts` → 发 Inngest 事件 `me/messenger.sync.completed` → Inngest `cloud-messenger-brief-after-sync`（在 cron_run_logs 里记作 `messenger-brief-hourly`，`src/lib/cron/registry.ts:229`）→ 写需求卡 + 自动标真买家 + 推断跟进阶段。`/api/cron/messenger-brief-hourly` 路由只是手动补触发（route.ts 头注释，且不写运行记录）。
- Render 定时 `meta-leads-hourly`（实际 `25 */2 * * *`，每 2 小时一次，14 天 168 次=12/天）→ 写 CRM。其下游：Inngest `lead-sheet-sync`（每小时 20 分，`registry.ts:339`，`src/lib/inngest/functions/lead-sheet-sync.ts`）把 CRM 里的线索追加到 CTS 的 Google 表格；Inngest `crm-lead-followup-digest`（`registry.ts:347`，每天一次）；Inngest `conversion-daily-pipeline`（`registry.ts:313`，每天 06:00 NZ）把成交/咨询回传 Meta CAPI。
- `google-data-pullback-daily`（Render）→ 每个客户发 Inngest 事件 `ads.diagnostics.completed_for_client` → `ads-d3-auto-pause`（`src/lib/inngest/functions/ads-d3-auto-pause.ts:436`）。

---

### ad-entity-snapshot （每 6 小时，`30 */6`）
- 写入：`ad_entity_snapshots`（共 6009 行，近 2 天新增 452 行）、`ad_snapshot_captures`（共 3205 行）。只读 Meta。
- a) 最近运行：2026-10-06 12:31 成功；14 天 56 次，55 成功 / 1 失败（失败原因 `[act_2202695063810470] unknown error`，CTS 第二个广告账户，单次抽风）；processed 合计 336（客户数，非行数，不是全 0）。
- b) 读取方：
  - 诊断加载器 `src/lib/ads-strategy/portfolio/diagnostics/loader.ts:172,183,197`（被 google-data-pullback-daily 调起）
  - D3 自动暂停 `src/lib/inngest/functions/ads-d3-auto-pause.ts:141,172`
  - Kernel 包络事实 `src/lib/capabilities/ads/envelope-facts.ts:144,186,392,603`；`src/lib/ads-strategy/circuit-cap-facts.ts:134,143`
  - 线索表格要广告名 `src/lib/lead-sheets/leads.ts:101`（lead-sheet-sync 每小时在读）
  - 接口 `src/app/api/clients/[id]/ad-health/o1-scale/route.ts:67,90`、`.../ad-accounts/[accountId]/daily-cap/route.ts:149`、`src/lib/ads-strategy/account-timezone.ts:59`、`agents/patrol.ts`
- c) 读取方在跑吗：在跑。pullback 每天真产出——`ad_health_narratives` 3 个客户每天一条，10/3、10/4、10/5 邮件状态 sent；lead-sheet-sync 每小时 completed；ads-d3-auto-pause 事件有收到但见 d）。
- d) 改变过决定吗：有例子。`docs/ledger/2026-09-27-cts-thruplay-audience-supply.md` 的 check_note：用 ad_entity_snapshots 核实 9/27 供血当天 ThruPlay 受众池 22200→22900、Video50% 38000→38800，比此前 10 天噪音（±400）高，用来判「供血有效」。反面：ads-d3-auto-pause 在 `flywheel_actions` 里 `action_type=ads.auto_pause_on_d3` 共 **0 条**（全历史）；CTS 自动驾驶开着但处于 dry-run，仍然 0 条 dry-run 记录，说明 D3 自动暂停那条线从没真正产出过。
- 结论：A；每天花费：Meta 读接口无费用；Render 约 86 秒/天（均 21.5 秒 × 4）；DB 约 226 行写入/天；建议：保留。

### ad-readback-sweep （每天 20:40，`40 20 * * *`）
- 写入：不写业务表，只写 cron_run_logs.summary（每个在投广告组的闸门结果 + 买家会看到的文案）。读 Meta。
- a) 最近运行：2026-10-05 20:40 成功；14 天 14/14 成功；processed 合计 79，非全 0。每天扫 7 个广告组，blocker 0、warn 2（14 天恒定）。
- b) 读取方：`src/lib/pm-todo/manual-monitoring-items.ts:355`（`pushAdReadbackItems`，读最近一次成功运行，只把 blocker 推成待办，warn 不推）。
- c) 读取方在跑吗：pm-daily-todo 近 14 天 10 次 completed（周日到周四），在跑。
- d) 改变过决定吗：有。cron_run_logs 全历史 51 条里 blocker>0 的日子：8/16–8/20（每天 1–2 个）、9/6、9/7；9/6、9/7 两天是 CTS「Retargeting - VideoViewers + FormOpeners」广告组「允许投给名单以外的人」开着（summary.results[].adSets[].findings），之后的日子 blocker 回到 0（说明被改掉了；改动人没有直接记录，推断）。待办是否真推出去：代码上会推，未查待办表。
- 结论：A；每天花费：Meta 读接口无费用；Render 约 9 秒/天；建议：保留。

### google-data-pullback-daily （每天 17:00，`0 17 * * *`）
- 写入：`gsc_performance_snapshots`、`ga4_traffic_snapshots`、`meta_ads_snapshots`、`ad_daily_insights`（含广告层）、`flywheel_metrics`、`ad_health_narratives`（含 portfolio_diagnoses）+ 发内部日报邮件（internal-digest）+ 发 Inngest 事件给 D3 自动暂停。`src/app/api/cron/google-data-pullback-daily/route.ts:155,718,752,795,932`。
- a) 最近运行：14/14 标 failed，但最新一次 10/5 17:01 实际 `gsc_synced 4 / ga4_synced 5 / meta_synced 3 / ad_daily_synced 6 / ad_health_synced 6 / ad_daily_rows 38 / ad_level_rows 97`；红的原因是 3 个没投广告的客户（Oztop `d5c98811`、`dce2795f`、East `2e3f040d`）的 `getAdAccountInsights empty_data` 被算成失败（已知，不重查）。另 `google_ads_synced=0`（Google Ads 数据源 14 天一次都没拉到，无连接）。各表最新数据：GSC/GA4 全部客户 10/5；`ad_daily_insights` CTS、NAL 10/5，**Magic Picks 停在 9/22**；`flywheel_metrics` 10/6。
- b) 读取方（节选，逐表）：
  - GSC：`src/lib/seo-patrol/job.ts:220`、`weekly-report/build.ts:209`、`seo-weekly-list/run.ts:501`、`seo-meta/cycle/runner.ts:239`、`oztop-seo-optimizer/route.ts:125`、`flywheel/attribution/gsc-bridge.ts:555` 等
  - GA4：`flywheel/adapters/Ga4Adapter.ts:49`、`strategy/auto-fetch.ts:131,541`
  - 广告：`ads-strategy/portfolio/diagnostics/loader.ts:152,188,195`、`ads-strategy/evaluate.ts`、`ads-strategy/digest.ts`、`dashboard/ad-engine/page.tsx:90`
  - 叙述：`api/clients/[id]/ad-health/route.ts:52`、`ads-d3-auto-pause.ts:102`
- c) 读取方在跑吗：seo-patrol-daily（14 天 10 次，9 完成 1 在跑）、weekly-seo-report（2 次 completed）、seo-meta-cycle step1–6（每周一次，completed）、attribution、ad-health 日报邮件（`ad_health_narratives` 10/3–10/5 逐日 sent）都在跑。
- d) 改变过决定吗：ad_health_narratives 里诊断真有命中：近 184 条叙述（7/20 起）D3 命中 10 次（CTS）、D4 命中 13 次、D7 命中 41 次（含 Magic Picks/NAL/Oztop/CTS）、D9 命中 9 次；NAL 的 D3 每天是 `not_comparable`（客户没设目标单次成本，11 次）。能否证明某次命中后 PM 改了广告：无直接证据（D3 自动暂停 0 条）。
- 结论：A（红灯是误报，真产出每天都有）；每天花费：外部接口（GSC/GA4/Meta）无按次费用；Render 约 106 秒/天；邮件 3 封/天（Resend，量很小）；建议：保留，并按已知结论改「失败」判定（按 客户×数据源×原因 分类），另查 Google Ads 为什么 0 条、Magic Picks 广告数据为什么 9/22 后断了。

### meta-leads-hourly（路由 meta-leads-sync，每 2 小时，`25 */2 * * *`）
- 写入：`contacts`、`contact_touchpoints`（channel=`meta_lead_form`，只有这一个写入口：`src/lib/crm/meta-lead.ts` 只被 `src/lib/meta/leads-sync.ts` 调）、Mailchimp 订阅（出口）。`src/lib/meta/leads-sync.ts:115,179,304`。
- a) 最近运行：2026-10-06 14:25，标 failed；14 天 168/168 failed（原因恒定：7 个客户里 Magic Lab Class / New Asian Logistics / NZCPE 2026 取表单报 HTTP 400 code=190「需要 pages_* 权限」，已知）。但另外 4 个客户在正常取：自 9/23 起的 164 次运行里 `newContacts` 合计 20、`leadsIngested` 合计 2066（CTS 取到 2033 条/新增 19，Roman 33/新增 1）。processed 合计 1176 是「客户数×次数」，不是线索数。
- b) 读取方：CRM 今天名单 `src/app/api/clients/[id]/crm/today/route.ts:158`；联系人列表 `crm/contacts/route.ts`；`lead-sheet-sync`（追加到 CTS 表格）；`conversion-daily-pipeline`；Mailchimp 出口结果被 `src/lib/pm-todo/manual-monitoring-items.ts` 读（`isMailchimpExportFailureKey`，meta-leads-sync 每次 tally）。
- c) 读取方在跑吗：全在跑。lead-sheet-sync 14 天 297 次、296 成功；conversion-daily-pipeline 14/14 成功；CRM 页面是被销售用的。生产库：近 14 天 `meta_lead_form` 触点 150 条（CTS 149、Roman 1），最新 10/6 14:16。
- d) 改变过决定吗：有。10/6 lead-sheet-sync 回执：一次追加 5 条新线索（leadId 1157789073717854 等）进 CTS 留资总表；conversion-daily-pipeline 把这些线索经 AI 审核后回传 Meta CAPI（14 天 33 条 confirmed，见下）。7/30 的成因注释：不接这条管道时 CRM 停在 7/25、Meta 后台进了 27 人销售看不到。
- 结论：A（对 CTS/Roman 有用）；但 3/7 客户长期取不到——**失败的 3 个客户的线索一条都没进 CRM**；每天花费：Meta 读接口无费用；Render 约 3.4 分钟/天；建议：保留；单独开卡修那 3 个页面的授权（NAL 线索是否通过表单走这条没验证）。

### messenger-hourly（路由 messenger-sync-hourly，每小时，`10 * * * *`）
- 写入：`conversations`、`conversation_messages`、联系人关联（link-contacts）；顺带同步 Microsoft 邮箱（CTS info@、NAL sales@，`route.ts` 头注释）；跑完发 Inngest 事件 `me/messenger.sync.completed`。
- a) 最近运行：2026-10-06 16:10 completed；14 天 336 次，334 completed / 2 running（卡在运行中没收口）；processed 合计 2972。**但每轮里 5/7 客户拉不到**：自 **2026-09-25 21:10 起** East International / Magic Lab Class / NZCPE / New Asian Logistics / Roman HU 全部报 `fetchPageConversations failed: HTTP 400 code=190 ...permission(s) must be granted`（9/23 起 NZCPE 一直失败，其余 4 家 9/25 21:10 之前是好的）。只有 CTS 和 NM Medspa 还能取。自 9/23 起 329 轮合计新消息 385 条、新建对话 119 条。邮箱那半每轮成功（10/6 16:10：CTS 抓 7 封、NAL 抓 7 封）。
- b) 读取方：需求卡写卡（下一项）、CRM 联系人/时间线 `crm/contacts/[cid]/timeline/route.ts`、messenger-agent 自动回复 `src/lib/messenger-agent/optout.ts`、`conversion-daily-pipeline` 的 NAL 私信扫描（`nal-messenger-lead-sync-run.ts`）、`src/lib/messenger/reply-metrics.ts`。
- c) 读取方在跑吗：在跑（见下一项 + conversion-daily-pipeline）。
- d) 改变过决定吗：有，CTS 每天有新对话进来（9/23 起新建 119 条）并生成需求卡/阶段；对 NAL：自 9/25 起 NAL 私信不再进来，conversion-daily-pipeline 的 NAL 段 14 天 insertedLeads=0（`nalSync.insertedLeads 0`），无证据说明这是因为真没咨询还是因为拉不到。
- 结论：A（CTS 在用）；每天花费：Meta 读接口无费用；Render 约 90 秒×24≈36 分钟/天；建议：保留，**开卡修 5 个客户的页面令牌**（9/25 21:10 是故障起点，可对照当天 Meta 令牌/权限改动）；顺手把 2 条卡在 running 的记录收口。

### messenger-brief-hourly（Inngest `cloud-messenger-brief-after-sync`，每小时，由上一项触发）
- 写入：`conversation_briefs`（共 723 行）；`contacts` 的跟进阶段（stage-infer）；真买家标签（qualified-buyer-autotag）。模型 `gpt-4o-mini`（`src/lib/messenger/brief.ts:108`）。
- a) 最近运行：2026-10-06 16:12 completed；14 天 334 条记录，316 completed / 18 running（没收口）；processed 合计 15800，几乎每次都恰好 50（9/23 起 327 轮里 305 轮 generated=50）。
- b) 读取方：`src/app/api/clients/[id]/contacts/route.ts:201`（CRM 联系人带需求卡）、`src/lib/crm/qualified-buyer-autotag.ts:125`；写阶段 `src/lib/crm/stage-infer.ts`。
- c) 读取方在跑吗：CRM 页面是销售在用；autotag 每轮跑（examined 69）；stage-infer 9/23 起 filled 185 次。
- d) 改变过决定吗：stage-infer 9/23 起 asked 159 / filled 185（真改了 CRM「跟进阶段」）；qualified-buyer 自动标：14 天 decided 0 / upgraded 0（从没触发过）。
- **🔴 发现一个真 bug（有证据）**：每小时都在把「最近 50 个私信对话」整批重写一遍，不是只写有新消息的。证据：①`generated=50` 几乎每小时恒定（15800/14 天），但 `conversation_briefs` 全表一共才 723 行，且最近一小时（16:12）50 行的 updated_at 完全相同，前面各小时只剩 1–2 行（被后一次覆盖）；②`regen_count` 全是 1（每次都当「今天第一次」）；③直接请求 PostgREST（`conversations?select=…,conversation_briefs(...)`）实测，一对一嵌套返回的是**对象** `{regen_count:1,...}` 而不是数组，而 `src/lib/messenger/brief-cycle.ts:147` 写的是 `row.conversation_briefs?.[0]` → 永远取不到已有的卡 → 每个超过 30 分钟安静期的对话都被当成「没写过卡」。结果是每天约 1200 次 gpt-4o-mini 调用，其中真正需要的约 70 次（今天更新过的不同对话数 66）。这是单窗口只读证据，没有改代码。
- 结论：A（卡有人用）但约 94% 调用是浪费；每天花费：模型约 1200 次/天 gpt-4o-mini，没有 token 日志，**没法精确估**，按每次约 2–3k 输入+0.5k 输出粗估 US$0.5–1.5/天（假设，缺：真实 token 用量表）；Render 约 244 秒×24≈97 分钟/天；建议：保留任务，修 `toCandidate` 兼容对象形状（改完预计模型调用降约 90%）。

### lead-sheet-sync （Inngest，每小时 20 分）
- 写入：CTS 的 Google 表格「CTS 留资总表 · FB 即时表单」（外部副作用）；回执写 cron_run_logs。`src/lib/inngest/functions/lead-sheet-sync.ts`。
- a) 最近运行：2026-10-06 15:20 成功；14 天 297 次，296 成功 / 1 失败（Google 524 超时，重试耗尽）；processed 合计 296（每次 1 个客户）；追加行数 9/24–10/6 合计 680（9/28–10/1 每天 48，之后每天 59–105，含补历史）。
- b) 读取方：CTS 销售团队直接看表格（人读）；`crm-lead-followup-digest` 的 sheet-notes 同步把表格里员工备注读回 CRM（见下项，10/5 CTS 表 817 行、652 行有备注、新插入 11 条）；`src/lib/pm-todo/lead-sheet-items.ts:70` 读运行记录。
- c) 读取方在跑吗：在跑（sheet-notes 同步每天跑、插入 11 条）；表格被谁点开无法从库里验证。
- d) 改变过决定吗：间接有证据：销售在表格里记的跟进被读回 CRM，并用于「谁今天该联系」（`crm-lead-followup-digest.ts` 头注释：331 个里 224 个表格上有记录）。
- 结论：A；每天花费：Google Sheets API 无按次费用；Render 约 11 秒×24≈4.5 分钟/天；建议：保留。

### crm-lead-followup-digest （Inngest，每天一次）
- 写入：本应发汇总邮件，实际不发；真正写的是把表格备注同步成触点（sheet-notes，`inserted 11`）和 cron_run_logs 回执。
- a) 最近运行：2026-10-05 19:00 completed；14 天 12/12 成功；processed 合计 84（客户数）。**12 次运行 `enabled=false`，`sent` 恒为 0**（9/24 至今每天挑出 14–16 条待跟进、积压 95→132 条一直在涨，一封信都没发）。
- b) 读取方：邮件收件人是写死的 `hello@magicengine.cloud`（`src/lib/inngest/functions/crm-lead-followup-digest.ts` 头注释：PM 9/24 拍板第一步只发给自己）；开关 `LEAD_FOLLOWUP_DIGEST_ENABLED` 没配 = 不发（`docs/ENV.md:204`）。
- c) 读取方在跑吗：开关没开 = 没有读者；sheet-notes 子步骤在跑。
- d) 改变过决定吗：邮件部分：无（从没发出过）；sheet-notes 部分：见 lead-sheet-sync。
- 结论：D（信没启用，PM 说「看两三天准不准再决定」已经 12 天没人回头）；每天花费：Render 约 160 秒/天，无模型（没看到调用模型的代码）；建议：改——要么 PM 回一句「开」，要么把挑名单那段停掉，只留 sheet-notes 同步。

### conversion-daily-pipeline （Inngest，每天 06:00 NZ）
- 写入：`me_sale_outcomes`（共 696 行）、`me_conversion_writebacks`（79 行）→ Meta CAPI（外部，往 Meta 回传线索事件）、CRM 触点。
- a) 最近运行：2026-10-05 17:00 成功；14/14 成功；processed 合计 86。9/22 起新增 98 条 outcome（CTS：69 rejected / 29 approved，AI 自动审核）；CAPI 回传 9/22 起 33 条全部 confirmed（`me_conversion_writebacks`）。NAL 段 insertedLeads 恒 0。
- b) 读取方：Meta 广告系统（CAPI 事件，外部读取方）；转化看板；`src/lib/pm-todo/payment-email-items.ts:44` 读 `summary.payments`。
- c) 读取方在跑吗：Meta 接收回执 `events_received:1`、`fbtrace_id` 有值（10/5 17:07 一条）；pm-daily-todo 在跑。
- d) 改变过决定吗：Meta 是否因此改了投放优化：无法证明（Meta 内部）。内部：AI 自动拒绝 69 条（14 天内过期/不合格）、批准 29 条，属于真实过滤。
- 结论：A；每天花费：CAPI 无按次费用；AI 审核每次约 1–6 条模型调用（日志没记 token，没法估）；Render 约 416 秒/天；建议：保留；NAL 段因私信拉不到长期 0，修令牌后恢复。

### social-comment-autoreply （每小时，`0 * * * *`，路由注释写 30 分钟但清单是每小时）
- 写入：`social_comment_engagements`（共 108 行）、`flywheel_actions`（action_type=`social.comment_auto_reply`，共 38 条，最后一条 8/20）；外部副作用：在 Facebook 公开回复/私信回复/隐藏评论。
- a) 最近运行：2026-10-06 16:00 completed；14 天 336/336 completed；processed 合计 336（每轮只有 CTS 一个客户）。但 `public_replies / private_replies / hidden` 在 9/23 起 329 轮合计 **全是 0**；每轮扫 146 个帖子（`posts_scanned 146`）、`new_comments 0` 居多。
- b) 读取方：设置页「评论审计列表」`src/app/dashboard/clients/[id]/settings/_components/CommentAuditList.tsx` ← `src/app/api/clients/[id]/comment-engagements/route.ts`（只有这一个读取方）；没有任何待办 / 周报读 `needs_human`（grep `pm-todo` 无）。
- c) 读取方在跑吗：页面存在，没法证明有人打开。数据：8/20 之后**没有一次成功回复**（`replied` 38 条全在 7/17–8/20），10/2–10/5 起连续 6 条 `failed`，原因 `replyToComment returned null (check pages_manage_engagement scope / rate limit)`；10 月还有 3 条 `pending`、`needs_human=true` 的评论（含 1 条投诉）没人处理。
- d) 改变过决定吗：8/20 之前每条回复是真回复了客户；8/20 之后无证据。
- 结论：D（回复这一步从 8/20 起就坏了，生成的「需要人看」评论没有任何出口）；每天花费：Meta Graph 读帖子约 146 次/轮×24≈3500 次/天；Render 约 57 秒×24≈23 分钟/天；分类用模型但只对新评论，量很小（约每天 1 条，没法精确估）；建议：改——先修 `pages_manage_engagement` 权限，并把 `needs_human` 的评论推进今日待办；修之前可降频到每天几次。

### social-engagement-pullback （每天 04:00，`0 4 * * *`）
- 写入：`flywheel_metrics`（`social.fb.posts_7d / reactions_7d / comments_7d / shares_7d / top_post_score / days_since_last_post`，共 732 行此类）；Publer 帖子互动、TikTok 资料（14 天 0 个客户配了 TikTok）。
- a) 最近运行：2026-10-06 04:01 成功；14/14 成功；processed 合计 0（Publer 那段 `total_posts` 恒 0，因为手工发的帖子不进 content_posts，代码注释自己承认）。真产出在 FB 页面汇总：5 个客户里 2 个 synced（CTS 看到 49 帖、NM Medspa），另 3 个页面同样 `code=190` 权限错。
- b) 读取方：`src/lib/weekly-report/build.ts:260,329–331`（每周日报里的「社媒」小节，`weekly-seo-report` 发给 `ME_MAIL_TO_ADDRESS` 内部）；`FlywheelDrawer.tsx`（执行页抽屉）。
- c) 读取方在跑吗：weekly-seo-report 14 天 2 次 completed；执行页是人用的页面，是否有人看不详。
- d) 改变过决定吗：无证据。
- 结论：B；每天花费：Meta 读接口无费用；Render 约 12 秒/天；Apify TikTok 0 次；建议：保留（成本极低），顺手修另外 3 个页面权限（和上面同一类）。

### attribution-cron （每 6 小时，`0 */6 * * *`）
- 写入：`flywheel_outcomes`（共 1048 行）。第一段按 flywheel_metrics 算，第二段按 GSC 快照算。`src/app/api/cron/attribution/route.ts`。
- a) 最近运行：2026-10-06 12:01 completed；14 天 56 次，52 completed / 4 running（没收口）；processed 合计 58270（每次约 1160 个动作）；每次 GSC 段 `outcomes_written 888`（重复 upsert 同一批）。平均耗时 562 秒（比 `maxDuration=300` 大，Render 上无影响）。
- b) 读取方：执行页 `src/lib/flywheel/execution-outcomes.ts:62` ← `src/app/api/clients/[id]/execution/route.ts`；记忆抽取 `src/lib/memory/extractor-load.ts:72,163`、周度学习汇总 `src/lib/memory/learning-rollup.ts:94,233`；案例库置信度 `src/lib/case-library/outcome-confidence.ts`；基准累积器 `benchmark-accumulator.ts:212`；Kernel `kernel/lineage.ts:63`；测量覆盖 `flywheel/measure-coverage.ts:28`。
- c) 读取方在跑吗：memory-extractor 14/14 成功（10/6 `outcomes_stale_skipped 49`）；agent-learning-rollup 2/2 成功（`preferences_inserted 0`）；benchmark-accumulator 2/2 失败（已知，缺列）；prescription-weekly 2/2 成功。
- d) 改变过决定吗：链路是通的：`flywheel_outcomes` → `client_proven_patterns` 162 行 / `client_failed_experiments` 130 行（最新 10/5 06:31）→ `loadMemoryForClient` 被 `prescription/generate`、`zhuge/conduct`、`zhangqian/discover` 等读。但**没有证据显示某个处方因此改变**；且 outcomes 里 913/1048（87%）是 `inconclusive`，confirmed 45、reversed 42；14 天只有 CTS(402)、Oztop(449) 两家占大头。
- 结论：B；每天花费：只读库不调外部接口，Render 约 562 秒×4≈37 分钟/天，数据库读取量大（没有每任务请求数日志，没法估，2026-08-03 的 `docs/audits/supabase-request-audit.md` 没有单列它）；建议：保留但改——每次重写 888 行不变的结果没意义，可只写变化的；4 条卡在 running 的收口。

### mailchimp-activity-daily （每天 04:40）
- 写入：`contact_touchpoints`（source=`mailchimp`，channel=`email`，metadata.email_opened/clicked），生产库 14 天新增 365 条，总 1426 条。
- a) 最近运行：2026-10-06 04:40 成功；14/14 成功；processed 合计 14（每次 1 个客户=CTS）；10/6 CTS 一个新批次 recorded 5。
- b) 读取方：`src/lib/crm/segments.ts:178`（`engagementFromMetadata`）→ `api/clients/[id]/crm/today/route.ts`、`crm/contacts/route.ts`、`contact-response-row.ts`（今天该打谁的名单分热度）。
- c) 读取方在跑吗：在跑（CRM 页面，销售用；今天名单每天算）。
- d) 改变过决定吗：有设计证据（路由头注释：点链接的人才是今天该打的），但没有某一天的具体例子；写入是真的有新数据（365 条/14 天）。
- 结论：A；每天花费：Mailchimp API（含在订阅里，无按次）；Render 约 112–138 秒/天；建议：保留。

### mailchimp-paid-tagging （每天 05:10）
- 写入：外部——Mailchimp 里给已付款客人打 `paid_customer`、摘线索标签；`needsReview` 写入 cron_run_logs。
- a) 最近运行：2026-10-06 05:10 成功；14/14 成功；processed 合计 27。近 30 条记录里 `tagged` 合计 1（9/29：tuzani@xtra.co.nz，证据「Thank you for the payment which is received well」）、`chasing` 29、`needsReview` 6、`notInAudience` 10。
- b) 读取方：Mailchimp 群发（被摘标签的人不再收群发，外部读取方）；`src/lib/pm-todo/manual-crm-items.ts:53`（needsReview 推成待办）。
- c) 读取方在跑吗：pm-daily-todo 在跑；Mailchimp 群发（CTS `auto_e1_batch_*` 每天一批）在跑。
- d) 改变过决定吗：有。9/29 那 1 人被自动打付款标签、移出群发名单——正是代码头注释里说的「9/1 群发混进 2 个已付款客户」同类事故的防护；6 条 needsReview 是否被人处理：无证据。
- 结论：A；每天花费：Mailchimp/Graph 邮箱读取无按次费用；Render 约 3 秒/天；建议：保留。注意与 `#2212`（付款邮件识别，conversion-daily-pipeline 里 `payments` 段）有功能重叠，别再各自长一套。

### mailchimp-suppression-sync （每天 05:20）
- 写入：外部——给 CRM 里判过「不感兴趣/别再联系」的人在 Mailchimp 打 `suppressed_do_not_email`。
- a) 最近运行：2026-10-06 05:20 成功；14/14 成功；processed 合计 469（遍历 35 个客户，近 20 次里 647 个客户次是 `skipped no_audience_id`，只有 CTS 真扫：每次扫 ~1130 人）。近 20 次合计 `newlySuppressed` 21、`alreadyTagged` 736。
- b) 读取方：Mailchimp 群发（外部）；合规：避免给明确拒联的人再发邮件。
- c) 读取方在跑吗：CTS 群发每天一批在跑（`mailchimp-activity-sync` 能看到 `auto_e1_batch_20261005`）。
- d) 改变过决定吗：有。21 个人被新抑制（20 次运行内），否则下一封群发会发给他们（路由头注释：9/8 实测 26 个被判过的人里 6 个还处于订阅）。
- 结论：A；每天花费：Mailchimp 无按次费用；Render 约 24 秒/天；建议：保留；可加「只对有 audience 的客户循环」，目前 35 个客户里 34 个每次空走。

### kpi-backfill （每天 06:20）
- 写入：`prescription_outcomes`（总共 15 行，最后一行 2026-08-20；`data_source=semrush_auto`，实际调 DataForSEO Labs `getDomainMetrics`，`src/lib/case-library/outcome-recorder.ts:14`，别名里叫 semrush 是历史名）。
- a) 最近运行：2026-10-06 06:20 成功；14/14 成功；processed 合计 56（每次 4）；`outcomes_written 0`，`skipped 0`，近 14 天一行没写。
- b) 读取方：`src/lib/huatuo/memory.ts:212`（华佗读上次处方的 outcomes）；`src/lib/case-library/retriever.ts:131`；`api/clients/[id]/prescription/[pId]/outcomes/route.ts:38`。
- c) 读取方在跑吗：华佗/案例库被处方生成按需调用，没有定时读取；总共 4 个已批准处方案例，30/60/90 天节点全部已量完（15 行 = 4 个案例），没有新的案例会到节点。
- d) 改变过决定吗：无证据；而且 Magic Lab Class 的 90 天值全是 0（authority_score/organic_traffic/organic_keywords=0），不可信。
- 结论：B（接近 C：数据已枯竭）；每天花费：几乎 0（0.5 秒；无到期案例不调 DataForSEO）；建议：停或降到每周；等有新批准的处方案例再恢复。

### goal-current-value-refresh （每天 17:30）
- 写入：`goals.current_value`（active 目标共 3 个，全是 CTS：`leads_count`=1、`seo_gsc_clicks_28d`=1042 更新于 10/5，`signups_count` 无值）。
- a) 最近运行：2026-10-05 17:31 成功；14 天 12 次全成功（不是每天都有，缺 2 天，未查原因）；processed 合计 30；`no_data`：1 个目标「成交数还没有任何记录」（每天一样）。
- b) 读取方：目标页 `.../goal/[goalId]/_components/CurrentValueCell.tsx`、`VerdictPanel.tsx`；`api/goals/[goalId]/judge/route.ts`；`pm-todo/manual-strategy-items.ts`；`anomaly-signals`；`goals-expiry-check` cron（14 天 9 次，1 失败）。
- c) 读取方在跑吗：pm-daily-todo、goals-expiry-check 在跑；页面是人用的，是否有人看无法验证。
- d) 改变过决定吗：无证据。
- 结论：B；每天花费：约 2.4 秒/天，无外部付费；建议：保留（成本可忽略）。

### linkedin-progress-post-mon （每周日 20:30 UTC = 周一 NZ）
- 写入：`content_posts`（platform 走 Publer 管道，借用 Magic Lab Class 客户 `377468af…`，source=`ME产品动态·LinkedIn`）；调用 Claude 写草稿（`src/lib/linkedin-progress/draft-post.ts`）。
- a) 最近运行：2026-10-04 20:31 completed（`skipped: no_new_entries`，CHANGELOG 没有新条目）；14 天 2 次 completed，processed 恒 0。
- b) 读取方：`src/lib/pm-todo/manual-linkedin-items.ts`（`linkedin_progress_needs_review`，PM 今日待办「review」类，`five-kinds.ts:129`）。
- c) 读取方在跑吗：pm-daily-todo 在跑。
- d) 改变过决定吗：无。生产库 source=`ME产品动态·LinkedIn` 共 10 条，**10 条全是 `draft`**（8/26 起每周两次，最新 9/27），**一条都没发出去**；9/27 的 mon 记录 `flagged: true, formatInvalid: true`，命中词是客户名、内部代号（子牙/魏征）、行话（migration/cron），即敏感词过滤每次都拦下，转草稿等人审，没人处理。
- 结论：B；每天花费：Claude 写草稿每周 2 次，量很小（没记 token，没法估）；建议：停或改——如果 PM 不打算审这些草稿，就停；如果要保留，必须先让草稿源头（CHANGELOG 写法）能过敏感词过滤，否则每次都白写。

### linkedin-progress-post-thu （每周三 20:30 UTC = 周四 NZ）
- 写入/读取方/读取方在跑：同上（共用 `src/lib/linkedin-progress/run.ts`）。
- a) 最近运行：2026-09-30 20:31 completed（`skipped: no_new_entries`）；14 天 2 次 completed，processed 恒 0；9/23、9/16、9/9、9/2 四次都是 `flagged + formatInvalid` 转草稿。
- d) 改变过决定吗：无；与 mon 合计 10 条草稿 0 条发布。
- 结论：B；每天花费：同上；建议：与 mon 一起处理。

---

## 汇总表

| 任务 | 结论 | 每天花费 | 建议 |
|---|---|---|---|
| ad-entity-snapshot | A | Render 约 86 秒；Meta 读无费用 | 保留 |
| ad-readback-sweep | A | Render 约 9 秒 | 保留 |
| google-data-pullback-daily | A（红灯是误报） | Render 约 106 秒；邮件 3 封 | 保留，改失败判定；查 Google Ads 0 条、Magic Picks 9/22 起断数 |
| meta-leads-sync | A（3/7 客户取不到） | Render 约 3.4 分钟 | 保留，开卡修 3 个页面授权 |
| messenger-sync-hourly | A（5/7 客户 9/25 起取不到） | Render 约 36 分钟 | 保留，开卡修 5 个页面令牌 |
| messenger-brief-hourly | A（但约 94% 调用浪费） | gpt-4o-mini 约 1200 次/天，粗估 US$0.5–1.5，没法精确 | 保留，修 brief-cycle.ts:147 取对象 |
| lead-sheet-sync | A | Render 约 4.5 分钟 | 保留 |
| crm-lead-followup-digest | D（开关没开，12 天 0 封） | Render 约 160 秒 | 改：PM 决定开不开，不开就只留 sheet-notes |
| conversion-daily-pipeline | A | Render 约 416 秒；AI 审核没法估 | 保留 |
| social-comment-autoreply | D（8/20 起回复一直失败） | Graph 约 3500 次读/天；Render 约 23 分钟 | 改：修权限 + 把需要人看的评论推待办，修好前降频 |
| social-engagement-pullback | B | Render 约 12 秒 | 保留（便宜） |
| attribution-cron | B | Render 约 37 分钟；DB 读量没法估 | 保留但改只写变化 |
| mailchimp-activity-daily | A | Render 约 2 分钟 | 保留 |
| mailchimp-paid-tagging | A | Render 约 3 秒 | 保留 |
| mailchimp-suppression-sync | A | Render 约 24 秒 | 保留 |
| kpi-backfill | B（数据枯竭） | 约 0 | 停或降周 |
| goal-current-value-refresh | B | Render 约 2.4 秒 | 保留 |
| linkedin-progress-post-mon | B（10 条草稿 0 发布） | Claude 每周 2 次，量小 | 停或让草稿能过过滤 |
| linkedin-progress-post-thu | B | 同上 | 同上 |

任务数 19（含 Inngest 链路上的 5 项）。A 11 / B 6 / C 0 / D 2。
