---
id: 2026-10-05-crm-precall-brief-v0
title: CRM 客人卡片顶部加「电话前 30 秒」框、缺项提示、超时标红（只展示，不发消息）
status: decided
owner: agent
decided_on: 2026-10-05
source: session:ebab7fb4
---
预沟通设计稿 PR-1：代码已写完并开 PR，等 PR 合并后改 done。
合格线索口径（PM 2026-10-05）：客人在表单开场白之后真的回复过才算；卡片上只读显示「客人已回复 / 还没回复」。
承诺时间：自表单提交日之后的第一个新西兰工作日结束（含公共假日，周末顺延）；假日表在 `src/lib/crm/holiday-calendars.ts`，每年要续。
未做：名单页的「已回复」标记（要批量查，留给后续）、「AI 已说过什么」（要新增数据库列，属后面的 PR）。
