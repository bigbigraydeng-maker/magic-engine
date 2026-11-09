# 「自动发信」页面 · 读数据接口约定 v0（给做页面界面的窗口；草案，只写约定，没写代码）

> 作者：发信设计窗口（会话 33ebcd0b）｜日期：2026-11-10（新西兰）｜风险：C（仅文档）｜状态：**草案，126／76／127 可提意见；页面窗口开工前以这份为准，改动请回我**
> 对应设计稿：Figma `https://www.figma.com/design/ifWBCRdYQWx5LmQArz1JvU`（v0.2，126 画）｜估算与分工：`docs/specs/2026-11-09-me-countdown-series-reestimate-v0.md` §4.2
> 本页**只是约定**：真实数据要等我这边的发信引擎（库结构放宽、批次计划、放行）做出来才有；**页面窗口先用 §6 的样例数据开发，不用等**。

## 0. 分工与边界（防撞车）

| 谁 | 管什么 | 文件范围（新建，互不重叠） |
|---|---|---|
| **138 号**（auto-send-page，`local_e9fda33e-3809-4d53-9080-1b7455e82bf1`；PM 11-10 回「另找窗口」） | 页面界面（入口、列表、右侧抽屉、三种特殊状态、手机版）＋**两条读接口的实现**（聚合、状态推导、原因码翻成人话）＋类型文件＋**批次计划函数**（纯函数、只读订单，见 §8）；按本约定做，不碰引擎 | `src/app/dashboard/clients/[id]/crm/auto-letters/**`、`src/app/api/clients/[id]/crm/auto-letters/**`、`src/lib/messaging/letters/**`；顶部导航加一项（改共享的 `CrmWorkspaceShell` / `buildCrmNavItems`，**要和 76 对**） |
| **我（发信设计窗口）** | 发信引擎（授权、发前检查、Resend、一键退订、回执）、库结构放宽、放行面板与授权命令（只许 PM）、把每人「发前检查结果」写进 `triggered_sends`；**审** 138 的计划函数和读接口（A 级审：它决定谁收哪封信） | `src/lib/messaging/triggered-send/**`、`src/lib/inngest/**`、`supabase/migrations/**`、`render.yaml`、放行面板 |
| 共同 | 类型文件 `src/lib/messaging/letters/types.ts`（只放类型） | **138 先提交**，我审；两边对着它写 |

> **11-10 晚修正**：本页第一版写的是「读接口实现和批次计划函数归我」，现改给 138，让我专心做发信引擎（缩短 1/6 的关键路径）；138 的工作量因此多约 3.5～5.5 天（读接口约 2.5～4＋计划函数约 1～1.5）。倒计时信的真实行要等我的库结构那一单之后才有，138 先用 §6 样例数据开发，不用等。

原则：只读、不新增表、**不返回任何邮箱**、页面不直接读数据库表。权限同 `crm/templates`（`requirePaidClientAccess`：付费客户员工可看；放行是另一条命令，只许 PM）。

## 1. 接口 A：列表 `GET /api/clients/[id]/crm/auto-letters`

```ts
interface AutoLettersList {
  generatedAt: string                      // ISO，服务器时间
  nextBatch: {                             // 顶部「下一批」卡片；没有就 null
    sendDate: string                       // YYYY-MM-DD（新西兰日）
    weekdayLabel: string                   // 「周三」
    letterCount: number                    // 4
    recipientCount: number                 // 21（去重后的人数）
    phase: 'draft' | 'awaiting_release' | 'sent'
  } | null
  depositLetters: LetterRow[]              // 面板「交了定金就自动发的信」
  scheduledLetters: LetterRow[]            // 面板「按期发送的信」：最近两批
  totalDistinctLetters: number             // 「共 32 个不同的信」
}

interface LetterRow {
  letterKey: string                        // 不透明；详情接口用。不要解析它
  sendDate: string                         // YYYY-MM-DD
  audience: { tourName: string; departOn: string; monthsLeft: number | null }   // 「3月11日团 · 3个月信」由页面拼
  subject: string | null                   // null = 还没写（显示「（还没写）」）
  status: 'draft' | 'awaiting_release' | 'sent'   // 草稿 / 等你放行 / 已发（对应 Figma 图例）
  channel: 'me' | 'mailchimp'
  counts: { recipients: number; sent: number | null; blocked: number | null; failed: number | null }  // 没发之前 sent/blocked/failed 为 null（显示「—」）
}
```
筛选（五个）在页面端对这份数据做：**全部 / 草稿 / 等你放行 / 已发 / 有被拦的**（`blocked>0 或 failed>0`）。「看这批」按钮＝页面把列表筛到 `nextBatch.sendDate` 那一批，不跳页。

## 2. 接口 B：详情 `GET /api/clients/[id]/crm/auto-letters/[letterKey]`

```ts
interface AutoLetterDetail {
  letter: LetterRow & {
    previewText: string | null             // 预览行；没有就 null
    bodyText: string | null                // 正文，含 {{first_name}} 占位符（页面用 sampleFirstName 代入显示）
    sampleFirstName: string                // 如 "Alex"，服务器给，页面不要自己编
  }
  tiles: { recipients: number; sent: number | null; blocked: number | null; failed: number | null }   // 抽屉顶部 4 个数字
  mailchimpSummary: { opened: number; clicked: number } | null    // 只有走 Mailchimp 的信有；ME 自己发的信为 null（页面显示「—」）
  recipients: RecipientRow[]               // 一批最多几十位，不分页
}

interface RecipientRow {
  contactId: string                        // 点姓名 → 打开客人抽屉（复用 ContactDrawerHost）
  displayName: string                      // 只给姓名，不给邮箱
  seats: number | null                     // 座位＝订单人数；订单没填就 null（显示「—」）
  status: 'pending' | 'sent' | 'blocked' | 'failed'     // 待发 / 已发 / 被拦 / 出错
  reasonText: string | null                // **人话，服务器翻译好**；页面直接显示，不要自己翻原因码
  opened: boolean | null                   // null = 这类信不记录（ME 自己发的信）
  clicked: boolean | null
}
```
错误与空：沿用 CRM 其它接口——`401/403` 无权限、`503` 暂时读不到，返回 `{ error: string }`（人话）；没有任何记录时返回空数组，**不是错误**（页面显示「还没有自动发信记录。第一批会在 X月X日 发出。」）。

## 3. 数据从哪来（现状 → 将来）

| 要的东西 | 来源 | 现状（11-10 核实） |
|---|---|---|
| 信的内容（标题、正文） | `crm_email_templates`（`subject`、`body`，按 `template_key` 取最新版） | 有；**没有预览行列**，我在库结构放宽那一单里加 `preview_text` |
| ME 自己发的信：每人状态 | `triggered_sends`（`trigger_key`、`contact_id`、`status`、`reason_code`） | 有表，但 `trigger_key` 现在被限定只许 `welcome`；**倒计时信的行要等库结构放宽之后才有** |
| 等你放行的提案 | `triggered_send_authorizations`（`authorized_at is null and revoked_at is null`） | 有表（现有 1 行欢迎信，未授权） |
| Mailchimp 发的信：每人发出／退回／打开／点击 | `contact_touchpoints`（`source='mailchimp'`、`direction='outbound'`，`metadata.email_campaign_title／subject／email_send_status`） | 有；**只记标题前缀 `auto_e1_` 的信**（客户设置 `leads_config.mailchimp_sent_record`），12/2 那批要先改设置（PM 点头）才有 |
| 姓名、座位、团、出发日 | `contacts.display_name`；`crm_bookings.party_size／tour_id／departure_depart_on` | 有 |
| 「下一批」「共 N 个不同的信」、还没写的信的收件人 | **批次计划函数**（订单收件人＋按「离出发几个月」分组；**138 写、我审**，规则见 §8） | 还没写 |

**状态怎么推**：letter.status——有未授权提案＝`awaiting_release`；已授权且开始发＝`sent`；其余＝`draft`（含「还没写」）。走 Mailchimp 的信：有任何发出记录＝`sent`，否则 `draft`（Mailchimp 的放行在 Mailchimp 里，不显示「等你放行」）。recipient.status——`sent／delivered／delivery_delayed`→`sent`；`blocked／skipped／suppressed`→`blocked`；`failed／bounced／complained／unknown_outcome`→`failed`；`pending`／彩排行→`pending`。

## 4. 原因码 → 人话（初稿；实现里集中放一个表，页面不翻）

| 原因码 | 显示 |
|---|---|
| `frequency_full` | 他最近 7 天已收 2 封 |
| `dnc` | 他要求别再联系 |
| `mailchimp_suppressed` | 他已在 Mailchimp 退订或邮箱无效 |
| `email_unsubscribed` | 他点过退订 |
| `no_consent_basis` | 查不到他同意收信的依据 |
| `sales_email_exists` | 销售已经给他写过信 |
| `bad_email` / `system_address` | 邮箱地址有问题 |
| `not_in_allowlist` | 不在试发名单里 |
| `excluded_tag` | 他带着不发信的标记 |
| `render_failed` | 缺少名字，这封信排不出来 |
| `stale` | 超过 3 天没发出去，已作废 |
| 退信（`bounced`） | 邮箱退回 |
| 其余未知 | 系统出错（别把原码显示给人） |

## 5. 不做什么
没有发送按钮；不显示邮箱；不建表；页面窗口**不要碰** `src/lib/messaging/triggered-send/**`、`supabase/migrations/**`、127 的 `src/lib/crm/email-templates/**`。放行（PM 点头）是我另做的命令，不在这页。

## 6. 样例数据（页面窗口先用它开发；姓名虚构）

```json
{
  "generatedAt": "2026-11-10T09:00:00+13:00",
  "nextBatch": { "sendDate": "2026-12-02", "weekdayLabel": "周三", "letterCount": 4, "recipientCount": 21, "phase": "draft" },
  "depositLetters": [],
  "scheduledLetters": [
    { "letterKey": "plan:2026-12-02:A:3", "sendDate": "2026-12-02", "audience": { "tourName": "Best of China", "departOn": "2027-03-11", "monthsLeft": 3 },
      "subject": "Your China tour: what March will feel like", "status": "draft", "channel": "mailchimp",
      "counts": { "recipients": 10, "sent": null, "blocked": null, "failed": null } },
    { "letterKey": "plan:2027-01-06:A:2", "sendDate": "2027-01-06", "audience": { "tourName": "Best of China", "departOn": "2027-03-11", "monthsLeft": 2 },
      "subject": null, "status": "draft", "channel": "me",
      "counts": { "recipients": 10, "sent": null, "blocked": null, "failed": null } }
  ],
  "totalDistinctLetters": 32
}
```
详情样例（ME 自己发的，已发出之后）：
```json
{
  "letter": { "letterKey": "me:countdown_20270106_A_2", "sendDate": "2027-01-06", "audience": { "tourName": "Best of China", "departOn": "2027-03-11", "monthsLeft": 2 },
    "subject": "Your China tour: two months to go", "status": "sent", "channel": "me",
    "counts": { "recipients": 10, "sent": 8, "blocked": 1, "failed": 1 },
    "previewText": "What to sort out now, and one thing to do at home.", "bodyText": "Kia ora {{first_name}},\n\n…", "sampleFirstName": "Alex" },
  "tiles": { "recipients": 10, "sent": 8, "blocked": 1, "failed": 1 },
  "mailchimpSummary": null,
  "recipients": [
    { "contactId": "c-0001", "displayName": "Alex Smith", "seats": 2, "status": "sent", "reasonText": null, "opened": null, "clicked": null },
    { "contactId": "c-0002", "displayName": "Jamie Lee", "seats": 1, "status": "blocked", "reasonText": "他最近 7 天已收 2 封", "opened": null, "clicked": null },
    { "contactId": "c-0003", "displayName": "Sam Taylor", "seats": null, "status": "failed", "reasonText": "邮箱退回", "opened": null, "clicked": null }
  ]
}
```

## 7. 还没定的（我和 126／76 对）
1. `letterKey` 的具体写法（不透明，但我要保证同一封信前后稳定）。
2. 「交了定金就自动发的信」面板的行怎么列：一人一行，还是按「订的日子＋团」合并成一行（现在设计稿示意一行）。
3. （已定，11-10 晚）批次计划函数由 138 写，不再是占位；我审。

## 8. 批次计划函数 `planCountdownIssue` 的规则与测试向量（138 写，我审）

**它只回答一件事：某一天，谁该收哪一封信。** 纯函数、只读订单，放在 `src/lib/messaging/letters/plan.ts`；我的发信引擎之后调它拿到「这天谁收哪封」，再做发前检查和发送。**同意依据、别再联系、7 天≤2 封、退订、Mailchimp 状态都不归它管**（那是发前检查，不改变「谁该收哪封」；页面另显示被拦原因）。

- **输入**：clientId、日期 D（新西兰日）。数据：订单（`crm_bookings`：`status='active'`、`departure_depart_on`、`party_size`、`contact_id`、`tour_id`）＋定金已付（`crm_booking_milestones`：`kind='deposit' and state='paid'`）＋联系人（`contacts.display_name`）。**收件人口径与 `src/lib/crm/sales-progress/deposited-seats.ts` 一致**（订单有效＋定金已付＋出发日≥D）。
- **批次日**：每月第一个周三；**最后一个月**（离出发 ≤30 天）改成每周三；最后一封停在**出发前 3 天以上**（≥3 天；更近的由运营直接联系）。
- **月数**：`monthsLeft = round(离出发天数 / 30.4)`，离出发天数＝出发日 − D；只发 6、5、4、3、2、1 个月；**不管哪天订都进「离你最近」那一组，前面错过的不补**。离出发 ≤30 天的日子走每周信（`monthsLeft = 'weekly'`）。
- **输出**（每个日子）：`{ letterKey, sendDate, tour, departOn, monthsLeft | 'weekly', recipients: { contactId, displayName, seats }[] }[]`；同一团同一天只有一封信（同团的人收同一封）。
- **第一版不含**：「定金确认→第一封」（订时离出发超 6 个月才有）——另一把刀，等 PM 回话。

**测试向量**（来自 126 的 `docs/clients/cts/email-templates/2026-11-09-countdown-series-jan-issue-sample-v0.1.md` §2；**138 用脚本复算，以脚本为准，不一致告诉 126 和我**；11-09 下午 21 位：A 10 位、B 1 位、C 5 位、D 5 位）：

| 团 | 出发日 | 批次日（离出发天数→月数） | 最后一个月每周三 |
|---|---|---|---|
| A 3/11 | 2027-03-11 | 12/2（99→3）、1/6（64→2）、2/3（36→1） | 2/10、2/17、2/24、3/3 |
| B 3/18 | 2027-03-18 | 12/2（106→3）、1/6（71→2）、2/3（43→1） | 2/17、2/24、3/3、3/10 |
| C 5/8 | 2027-05-08 | 12/2（157→5）、1/6（122→4）、2/3（94→3）、3/3（66→2）、4/7（31→1） | 4/14、4/21、4/28、5/5 |
| D 5/13 | 2027-05-13 | 12/2（162→5）、1/6（127→4）、2/3（99→3）、3/3（71→2）、4/7（36→1） | 4/14、4/21、4/28、5/5 |

边界要测：3/3 对 A 是每周信、对 C／D 是「2 个月」信；4/7 对 A／B 已出发，什么都不发；5/12 离 5/13 出发 1 天，不发；同一团所有人同一封；人数合计 12/2 当天应是 4 封信、21 位收件人。

## 9. 138 的三个问题（我的答案）

1. **批次计划（哪天、哪些信、哪些人）由谁算**：你写 `planCountdownIssue`（§8），我审。
2. **信的登记（标题／预览行／正文）存哪**：`crm_email_templates`（`template_key` 约定 `auto-countdown-<yyyymmdd>-<团码小写>-<月数>`，状态「停用」＝草稿；标题＝`subject`，正文＝`body`）。**11-10 改：一律 `auto-` 开头**——发信底座第 1 单起，`auto-` 开头的模板销售在「通话后发邮件」里选不到、手发也会被拒（`src/lib/crm/email-templates/automated-template-key.ts`）；模板键只许小写字母、数字、连字符、最长 63 位，团码要转小写。**预览行**表里目前没有列，我在库结构放宽那一单里加 `preview_text`；在那之前接口把 `previewText` 返回 `null`，页面按「没有预览行」显示。126 的定稿文字怎么录进去：我做登记工具，v0 是手工录入（像 `auto-welcome` 那样）。
3. **走 Mailchimp 的 12/2 批次发送情况从哪读**：`contact_touchpoints`（`source='mailchimp'`、`direction='outbound'`；`metadata.email_campaign_title／email_campaign_subject／email_send_status`，打开点击见 `kind`），**但只记标题前缀 `auto_e1_` 的信**。12/2 那批要被记录，需要 PM 点头改 `clients.leads_config.mailchimp_sent_record.title_prefixes`（126 在 11/30 问他）。在那之前页面把 12/2 批显示成「草稿」、发送情况「—」。
