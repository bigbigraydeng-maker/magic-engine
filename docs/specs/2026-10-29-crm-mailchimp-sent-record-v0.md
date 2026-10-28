# CRM 记下「Mailchimp 替我们发出的邮件」设计稿 v0.1（2026-10-29，已吸收子牙+魏征设计两审）

## 1. PM 要什么
PM 2026-10-29（看着客人抽屉）：「我们使用 Mailchimp 发送的欢迎邮件，在 CRM 里点开用户抽屉弹卡，没有显示」→「做记录」。

## 2. 事实（只读生产库 + 读代码，2026-10-29）
- `src/lib/mailchimp/sync.ts` 每天 04:40 UTC（cron `mailchimp-activity-sync`，登记在 `cron/registry.ts:192`）把邮件反应写成触点，**只拉「打开明细」和「点击明细」**（`client.ts:228-260` `getCampaignActivity`）。收到了没打开的人一条都不写；`sync.ts` 里「收到《…》」那句文案（`summarise`）永远用不上。
- 库里 Mailchimp 触点：入站 2061 条（打开/点击，最晚 10/15 之后零星），出站只有 25 条且全在 7/29 一天（旧导入）。每天 8:02 的欢迎信批次（`auto_e1_batch_YYYYMMDD`，每天 0–2 人）在同步回执里 `recorded:0`——正是因为收件人没打开。
- 同步每天正常完成（`cron_run_logs` 近 8 天全 `completed`，约 150 秒，43 封邮件）。
- 已有的识别「机器发的出站」判据：`src/lib/crm/automated-touch.ts` `isAutomatedTouch(source, metadata)`（`source='mailchimp'` 整类算机器）；`contact-model.ts:77-78` 已把它带进名单模型的 `automated` 字段。

## 3. 查了哪三处平台能力（Reuse First）
1. `mailchimp/sync.ts` + `client.ts`：同一条同步，新增「收件人」读取，不新建 cron / 不新建表。
2. `isAutomatedTouch` / `automated` 字段：出站机器信不算「有人跟过」的既有机制，沿用。
3. `contact_touchpoints` 的 `UNIQUE(client_id, source, source_ref)` 幂等：沿用，只是 `source_ref` 要另起后缀避免与打开/点击记录撞键。

## 4. 设计
- 读：Mailchimp `GET /reports/{campaign_id}/sent-to`（每个收件人一行，含 `status`：`sent` / 退信类），沿用 `fetchAllMembers` 分页（每页 1000，安全阀 50000）。
- 写：每个（邮件, 已认出的客人）一条触点：`channel='email'`, `direction='outbound'`, `source='mailchimp'`, `source_ref = '<campaignId>:<contactId>:sent'`（与现有 `<campaignId>:<contactId>` 的打开/点击记录互不冲突），`occurred_at = 邮件发出时间`，`summary = '发出《<主题>》'`（主题沿用 `campaignLabel`，已处理垃圾标题），`metadata = { automated: true, email_campaign_id, email_campaign_subject, email_send_status }`。
- 仍然只认得出的人才写，**绝不为一个只在 Mailchimp 里的邮箱建人**（沿用，`unmatched` 如实计数）。
- 退信（硬退）不写成「已送达」：`email_send_status` 原样存，summary 写「《…》未送达」。
- 回补范围：沿用同步原有的近 90 天、最多 50 封；一次写入量预计几千行（含群发新闻信），`upsert ignoreDuplicates`，可重跑。每封邮件内部按批（每批 ≤500 行）写，单批失败不拖垮整封。
- 时间预算：每封邮件多 1–2 次 API 调用；同步现约 150 秒，上限 600 秒（`route.ts maxDuration`）。设本轮「收件人读取」独立时间预算（约 240 秒），到点停并在回执里写 `sentToSkipped`。
- 显示：抽屉时间线里「方向=出站、来源=mailchimp」的触点显示「📧 Mailchimp 发出 · 《主题》」（需查 timeline 路由与 `PersonDrawer` 对出站邮件的现有渲染，确保不被当成「员工写的信」）。

## 5. 风险与必须核实的下游（交审查人逐条对代码）
这是**一次给约上千位客人加上出站触点**，下游所有读触点的地方行为都可能变：
1. **名单分段与「最近联系」**：`segments.ts` / `contact-model.ts` / `day-list.ts` 对出站且 `automated` 的触点是否真的不算「有人联系过」「我们已回」；「最近联系」排序是否会被机器信顶到最前（PM 在名单上会看到全都「今天」）。
2. **`stage-infer` 读对话**：`loadTranscriptLines` 把邮件触点喂给模型判阶段——机器群发信会不会污染判断（需要排除 `source='mailchimp'` 出站？）。
3. **有效咨询筛选 `eligibility.ts`**：`has_outbound` 会让收过群发信的人永远不进筛选；这是否可接受。
4. **`advance-after-call`、`lead-followup-due`、`email-reply-due`、`today` 路由**：凡判「我们是否回过信 / 联系过」的，是否都认 `automated`。
5. **7 天 2 封上限**（PM 10-08 定）：现在系统数不出每人近 7 天收了几封；本稿**只把数据记下来，不做上限校验**，列为后续卡。
6. 回补一次写几千行对 `contact_touchpoints` 读性能的影响（`contacts` 路由全量拉触点）。

## 6. 不做
不改 Mailchimp 里任何东西；不发信；不新建人；不改阶段；不做 7 天上限闸；不改「入站打开/点击」既有记录。

## 7. 风险级别：A
理由：一次性给约上千位客人写入新触点（客户数据），改变所有读触点处的输入；改的是已登记的 cron 同步。无数据库表结构改动（沿用现有表和唯一键）。流程：设计两审 → 实现 → 代码两审 → PM 回「合」。

## 8. 当场试跑方案（交付前必须）
本机无生产密钥权限，**不能手动触发整条同步**。试跑办法：合并后在 Render 手动触发该 cron 一次（`POST /api/cron/mailchimp-activity-sync`，需 PM 或有密钥的人），读回执 `recorded` / `sentRecorded` / `unmatched` / 时长，再抽查 3 位客人抽屉。**未试跑前不得称完成。** 台账卡 `verify_by` = 合并当天。

## 9. 待审查人回答
1. 上面 §5 六条，逐条对代码给「会/不会/要改什么」。
2. `source_ref` 加 `:sent` 后缀是否与既有读取（按 `source_ref` 或按 `email_campaign_id` 去重的地方）冲突？
3. 回补几千行 + 每天几十行，写入方式（upsert ignoreDuplicates 分批）是否稳。
4. 退信/未送达怎么记最合适。

## 10. 两审结论与处理（v0.1 新增；两位审查员独立只读，均判「v0 不能直接动工」）

两位交叉印证的问题（已对代码核实）：
| # | 问题 | 处理 |
|---|---|---|
| R1 | `stage-infer.ts:186-193` 读触点不看来源，`stage-from-conversation.ts:250-262`「对方没回 + 我们发过 + 过两周 → 无下文」会把只收过欢迎信的人永久写成「无下文」。 | `loadTranscriptLines` 读触点多取 `source/metadata`，**机器发的出站（`isAutomatedTouch`）不喂给模型**。 |
| R2 | `contact-enrichment.ts:212-216` 只要有任何出站邮件触点，就不再补「同事从 info@ 真发的信」。 | 判断改为「**非机器发的**出站邮件触点」才挡。 |
| R3 | 「全部客人」默认按最近一条触点排序（迁移 `20261014100000_crm_contacts_page_by_latest_touch.sql:32,54` + `contacts/route.ts:351-356`），不分来源；大群发会整体顶乱。改这条要改数据库函数（A 级，PM 亲手合）。 | **缩小范围规避**：只记**标题前缀在客户配置里**的邮件（欢迎信 / 自动信，每人一封、每天 0–2 人），不记几百人的新闻信。`leads_config.mailchimp_sent_record.title_prefixes`，缺省 = 不记。**记全量群发需要先改那个数据库函数——列为后续卡，本稿不做。** |
| R4 | `sync.ts:180` 写入出错会中断整趟同步。 | 「发出」记录**单独 try/catch**，失败只计 `sentErrors`；原有打开/点击先写完，互不影响。 |
| R5 | 抽屉时间线 `timeline/route.ts` 不取 `source`，机器信会显示成「我们说的话」、并盖掉顶上「最后一句」。 | 路由多取 `source`，entry 带 `automated`；抽屉标「系统自动发出」，`summarise` 里跳过机器信。 |
| R6 | 按「最新邮件先处理」，时间预算可能总卡在同一封。 | 预算 240 秒，超出的计 `sentSkippedBudget` 写回执；因每天只有几封自动信，下一轮自然补上（最旧的未做的仍在 90 天窗口内）。 |
| R7 | `marketing-plan/generate/route.ts:194` 按 `metadata.email_campaign_title` 以 `auto_` 数「近 7 天收过自动信」。 | 新记录 `metadata` 带 `email_campaign_title`。 |
| R8 | 回退：`:sent` 后缀能定位，但不够。 | `metadata.kind='sent'` + `ingest_batch`（本次同步开始时间），可一条 SQL 删净。 |
| R9 | Mailchimp 收件人端点数组字段叫 `sent_to` 不是 `members`；状态 `sent/hard/soft`；无每人发送时间。 | 已按此实现；退信写「退回（地址无效）」「暂时没送达」，不写成已送达。 |
| R10 | `eligibility.ts:112` `has_outbound`：收过欢迎信的人不进有效咨询筛选。 | 目前无调用方从库读数据喂它（子牙核实），暂不生效；记入已知限制。 |

已核实**不受影响**（已认 `automated`）：`segments.ts:640-643`、`day-list.ts:343-345`、`advance-after-call.ts:105`、`lead-followup-due.ts:145`、`email-reply-due.ts:322-326`、`revive.ts:74`、`today` 路由 376。

## 11. 上线顺序（需 PM 亲口）
1. 合并本 PR（缺省不记，**什么都不变**）。
2. PM 说「开欢迎信记录」→ 写一行 CTS 的 `leads_config.mailchimp_sent_record = {"title_prefixes":["auto_"]}`（生产库写入）。
3. 手动触发一次 `POST /api/cron/mailchimp-activity-sync`，读回执 `sentRecorded` / `sentErrors`，抽查 3 位客人抽屉。

## 12. 代码两审后的追加（v0.2）
- 子牙：`stage-infer` 与时间线/抽屉对「机器发的」判断**只针对邮件渠道**（AI 外呼也标了 `automated`，其 `raw` 是通话摘要，必须仍交给模型）；时间预算只累计「发出」记录自己的耗时。
- 魏征：「全部客人」每行「最近联系」（`contact-response-row.ts`）原先把所有触点取最晚一条，欢迎信会把昨天进来的新客人每天一早算成「今天已处理」——已改为**机器发的出站邮件不算**；补测试。前缀判断补「必须从头匹配」测试；中途某批写入失败，前面已写的条数如实计入回执。
- 建议开启时前缀配 `auto_e1_`（只欢迎信第一封），不用 `auto_`（会连带 E2–E4 发给老客人的批次，回补量更大）。
- 已知小项不做：按房子看客人那页（`/api/clients/[id]/contacts/route.ts`）「最后一句」会显示「发出《…》」，只在开启记录的客户上出现；`marketing-plan/generate` 的「近 7 天收过自动信」人数会含退信者。
