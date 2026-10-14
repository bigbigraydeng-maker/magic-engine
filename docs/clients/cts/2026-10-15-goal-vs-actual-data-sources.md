# 「目标 vs 实际」监控的数据口径清单（CTS）

- **日期**：2026-10-15 ｜ 窗口：74（CTS 广告总控）｜ 给：115（统筹规划页）
- **用途**：115 在统筹规划页做「目标 vs 实际」时，每一格数字该读哪张表、哪个字段、多久刷一次、已知会读错的地方。
- **本文所有表名、字段名、班期、行数都是 2026-10-15 当天在生产库（CrazyContent）和仓库里查到的**，不是凭记忆写的。只读查询，没有改任何数据。
- **风险级别**：C（纯文档）。

---

## 0. 三条贯穿所有指标的口径（不照这三条做，页面一定会骗人）

1. **「有没有新数据」看取数时间，不看业务日期。** `ad_daily_insights` 今天最新的业务日期是 2026-10-10，但 `fetched_at` 是 2026-10-14 17:02 —— 取数任务一直在跑，是广告账户停投所以没有新行。只看业务日期会报成「取数坏了」，只看取数时间会报成「一切正常」。**两个都要显示。**
2. **读回零行不等于没事。** 这个库的读权限被挡时返回的是「零行、不报错」。任何一格读到 0，页面要能区分「真的是 0」和「没读到」，否则监控会自己变绿（已有先例，见 `src/lib/pm-todo/platform-connection-items.ts` 头注）。
3. **计划值和实际值必须分开存、分开显示。** 计划来自 105 维护的计划内容，实际来自下面这些表。禁止把计划值写回这些表当实际值用。

---

## 1. 广告

| 指标 | 表 / 字段 | 刷新 | 已知坑 |
|---|---|---|---|
| 已花钱 | `ad_daily_insights.spend`（按 `insight_date` 汇总，`client_id` + `level` 过滤） | 每天一次，`google-data-pullback-daily`，`0 17 * * *` UTC | 同一天会被重复取数并 upsert；取「最后一次取到的值」而不是累加。按 `level` 过滤，不然 campaign/adset/ad 三层会把金额叠三遍 |
| 计划花多少 | 不在这些表里，来自 105 的计划 | 人工 | 「日上限」在 ME 里的口径是**各广告设置的预算加起来**（PM 10-10 定），不是实际花费；两者别混在一格里 |
| 频次 | `ad_daily_insights.frequency`、`frequency_7d` | 同上 | `frequency` 是当天值，`frequency_7d` 是 7 天值；给人看的那个要用 7 天值，当天值天天跳 |
| 触达 / 曝光 | `reach`、`impressions` | 同上 | `reach` 不能跨天相加（同一个人会被算多次），要显示就只显示单段时间内 Meta 给的那个数 |
| 表单线索 | `contact_touchpoints` 里 `channel='meta_lead_form'`，按 `occurred_at` 数 | 每 2 小时，`meta-leads-hourly`，`25 */2 * * *` | 另有 `ad_daily_insights.leads`，和上面那个数**对不上**：一个是 Meta 报的归因数，一个是真落进客户管理系统的人。两个都显示，并标明哪个是人 |
| 私信结果 | `ad_daily_insights.messaging_conversations`；真会话在 `contact_touchpoints` `channel='messenger'` | 同上 | 库里没有「这条私信是真人还是机器」的标签，只能推断，别在页面上写成确定结论 |
| 哪条广告带来的 | `contact_touchpoints.attr_campaign_id / attr_adset_id / attr_ad_id / attr_ad_name` | 随线索进来 | 这几列可能为空（自然流量或归因丢失），空值要显示成「来源不明」，不能并进任何一条广告 |
| 账户是不是停了 | `ad_entity_snapshots.account_status`、`disable_reason`，取 `captured_at` 最新那条 | 每 6 小时，`ad-entity-snapshot`，`30 */6 * * *` | 当前 CTS 账户 `account_status = 3`（欠款未结），这就是 10/10 之后没有新广告数据的原因。**判恢复不能只看这一位**：要同时看到当天有新的 `ad_daily_insights` 行、并且表单线索回到每天 5 条以上 |

**当前实际数（10-15 查）**：`ad_daily_insights` 共 1004 行，最新业务日期 2026-10-10，最后取数 10-14 17:02。

---

## 2. 邮件

| 指标 | 表 / 字段 | 刷新 | 已知坑 |
|---|---|---|---|
| 已发几封 | **ME 库里没有。** 发送动作在 Mailchimp，库里没有任何一张表记录「我们发出去了几封」 | — | 🔴 最大的坑：`contact_touchpoints` 里 `source='mailchimp'` 的 1785 行**不是发送记录，是打开和点击**（`metadata.email_opened / email_clicked`），而且 `direction` 被写成了 `inbound`。按它数「已发数」会得到一个完全错误的数，而且看起来很合理。要显示已发数，只能去 Mailchimp 取 |
| 打开 / 点击 | `contact_touchpoints` `source='mailchimp'`，看 `metadata.email_opened`、`email_clicked`、`email_campaign_id` | 每天一次，`mailchimp-activity-daily`，`40 4 * * *` | 一个人打开两次会有两行，数人要去重 `contact_id` |
| 7 天 2 封上限 | **没有程序在拦，也没有地方记。** 规则是 PM 2026-10-08 定的（任何 7 天内同一个客人不超过 2 封，所有邮件类型合计） | — | 页面上这一格只能从 Mailchimp 取数现算：按收件人数最近 7 天的发信次数。**不要显示成「已守住」**——现在没有任何自动检查，只能显示实际数字 |
| 不再联系的人 | `contacts.do_not_contact` + `contact_touchpoints.metadata.outcome='do_not_contact'`，判定只认 `src/lib/crm/dnc.ts` 的 `isDoNotContact()` | 抑制同步每天一次，`mailchimp-suppression-sync-daily`，`20 5 * * *` | 不要自己写判定逻辑，调那个函数。`contacts.do_not_contact` 只是镜像，真相在不可改写的 touchpoint 里 |
| 客人来信 / 我们回信 | `contact_touchpoints` `channel='email'`、`source='microsoft_mail'`，按 `direction` 分 | 每小时收信 | bdm@ 这个邮箱从 2026-09-15 起是断的，它那一份信一条都没进来。这一格要能按邮箱分开显示，否则一个坏邮箱会被另一个正常邮箱盖住 |

---

## 3. 社媒

| 指标 | 表 / 字段 | 刷新 | 已知坑 |
|---|---|---|---|
| Story 已发 / 排队 | `story_items`：`status`（PENDING / CLAIMED / SENT / UNKNOWN_OUTCOME / FAILED / BLOCKED / MISSED）、`slot_at`、`sent_at`、`provider_receipt` | 每 10 分钟，Inngest `TZ=Pacific/Auckland */10 * * * *` | 「已发」只认 `status='SENT'` 且 `provider_receipt` 非空。`UNKNOWN_OUTCOME` 既不算发了也不算没发，要单独一栏；错过的时段是 `MISSED`，不要混进失败 |
| Story 这一批有没有被授权 | `story_packs.authorized_at`、`expires_at`、`revoked_at`、`authorized_content_hash` | 人工授权 | 授权有 7 天有效期，过期即失效；`revoked_at` 有值就是被撤了。**状态字段不等于授权**，判能不能发要看这几列 |
| 图文 Post 已发 | `content_posts.published_at` 非空；自动发布的尝试记录在 `daily_plan_auto_publish_attempts` | 自动发布按每日计划 | 🔴 CTS 到今天 `content_posts` 只有 **1 条**有 `published_at`（2026-09-23），`daily_plan_auto_publish_attempts` **0 行** —— 自动发图文帖对 CTS 从来没真跑过。这一格现在显示 0 是对的，别当成坏了 |
| Reel 已发 / 在产 | `content_work_orders.status`，按 `client_id` 过滤 | 出片与审查随时 | 当前 CTS：已发布 8、在审 14、被审查打回 11、死信 3、被新版取代 36。**「在审」不等于可发**，要过审查 agent 那一关；死信是技术失败（最近一次是素材文件被 Dropbox 转成仅云端），要单独一栏 |
| Reel / Post 的数据（看了多少） | `social-engagement-pullback`，`0 4 * * *` | 每天一次 | 读数链目前是断的：最近 3 天 0 行（已开台账卡 `2026-10-14-cts-reel-draft-first-no-measurement`）。这一格要显示「最后一次读到数据是哪天」，不要显示成 0 |
| 发布尝试的回执 | `daily_plan_auto_publish_attempts`：`status`、`reason_code`、`attempt_no`、`post_id` | 随尝试 | 同一件事重跑会覆盖，看到的是**最后一次**尝试，不是第一次。要看全过程得按 `attempt_no` 排 |

---

## 4. 给 115 的三条实现建议

1. 每一格都带两个时间：**业务日期**和**最后取数时间**。只给一个，页面一定会在某天骗人。
2. 读到 0 的格子要能说出是哪种 0：真的没有、没读到、或者这条链路本来就没接。上面标 🔴 的三格现在都是「本来就没接」。
3. 邮件「已发数」和「7 天 2 封」这两格，不要从 ME 库里找数——库里没有。要么接 Mailchimp，要么这两格先留空并写明原因。

## 5. Reuse Statement

- 复用了什么：全部是已有表和已有判定函数（`isDoNotContact`、Story 状态机、`ad_daily_insights` 系列、`content_work_orders`），没有新增任何表、字段或能力。
- 平台共享的部分：上面第 0 节三条口径（取数时间 vs 业务日期、零行不等于没事、计划与实际分开）是平台层规则，对任何客户的「目标 vs 实际」页面都成立。
- 行业特定：无。
- 客户特定：CTS 的实际数字、账户欠款状态、bdm@ 邮箱断线、自动发图文帖从未跑过——这些都是客户现状，只写在本文件里，不进共享代码。
- 有没有把客户事实写进共享代码：没有，本次只写文档。
