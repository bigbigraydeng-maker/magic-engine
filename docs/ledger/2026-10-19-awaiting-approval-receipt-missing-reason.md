---
id: 2026-10-19-awaiting-approval-receipt-missing-reason
title: 自动暂停提交等批准时写的回执没有人话说明，PM 在待办里会看到一条读不懂的记录
status: decided
owner: agent
decided_on: 2026-10-19
source: session:c668eb35
verify_by: 2026-10-26
verify_how: 改完后重跑一次演练（真代码 + 内存替身，不碰生产），看 awaiting_approval 那条回执里 reason 有没有一句人话；顺带确认今日待办的渲染会把它显示出来。
---
演练实测：`dry_run_logged`、`blocked`（两种）、`failed` 四条回执都带 `reason`，只有 `awaiting_approval` 那条没有（`src/lib/inngest/functions/ads-d3-auto-pause.ts:440` 附近）。
后果：真要人批准时，PM 看到的是一条没有说明的记录，得自己从 `diagnosis_title` 拼出发生了什么。
建议补一句，例如「花钱没结果，已提交等你批准暂停这个广告组」。
C 级小改动，不碰判据、不碰钱。
排在「D3 判据为什么天天不可比」之后做，那个更要紧。
