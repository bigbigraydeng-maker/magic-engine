# 客人沟通 — Agent 手册（骨架）

> 代号：`conversation` ｜ 分组：2026-10-28 新增挂名位（CRM / 客人沟通）
> 状态：**骨架档案。PM 2026-10-28 批准新增这个挂名位，只给已有的「无主」自动程序找归属，不新增能力。下面只抄 `docs/agents/2026-10-18-automation-inventory.md` 已有的清单，其余写「待补」，不编事实。**
> 依据：[自动程序全量清单](./2026-10-18-automation-inventory.md)「无主」一节（2026-10-18 快照，会过时，以代码为准）。

## 名下程序（来自清单，未重新核）

- 私信与邮箱：`messenger-sync-hourly`、`cloud-messenger-brief-after-sync`、`mailbox-sync`（不排班）、`email-reply-digest`（暂停）
- 自动回复：`cloud-conversation-inbound-autoack`（清单查到 2026-10-18 所有客户渠道开关全关）、`cloud-conversation-inbound-draft`（AI 起草，人批准后才发）
- 电话：`cloud-telephony-voipline-process`、`cloud-telephony-voipline-sweep`、`cloud-telephony-call-analysis`、`cloud-telephony-call-analysis-sweep`
- 线索与邮件名单：`meta-leads-sync`、`mailchimp-activity-sync`、`mailchimp-paid-tagging`、`mailchimp-suppression-sync`、`cloud-lead-sheet-sync-fanout`、`cloud-lead-sheet-sync-one`
- 提醒与知识：`cloud-crm-lead-followup-digest`、`cloud-knowledge-mining-requested`（全仓没人发这个事件）、`cloud-tools-lab-lead-followup`、`cloud-tools-lab-report-email-receipt`

## 待补

目标、闹钟、不问 PM 就能做 / 必须问 PM、红线（CTS 同一客人 7 天内群发不超过 2 封等）、与诸葛亮 / 苏东坡的交接：待补（需读代码与台账后补，本骨架不写）。

## 操作手册

暂无。
