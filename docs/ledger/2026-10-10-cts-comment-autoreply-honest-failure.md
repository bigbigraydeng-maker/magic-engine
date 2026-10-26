---
id: 2026-10-10-cts-comment-autoreply-honest-failure
title: CTS 评论自动回复：拉太多数据时自动减半重试、整轮没扫完如实记失败、连续失败进待办
status: decided
owner: agent
decided_on: 2026-10-10
source: session:6344863e
verify_by: 2026-10-17
verify_how: PR 合并上线后，查 cron_run_logs 里 social-comment-autoreply 最近 7 天：若出现整轮没扫完，状态必须是 failed（不再是 completed）；连续 6 轮失败时今日待办开发栏出现一条；summary 里 list_halvings 能看到减半次数
---
重做旧 PR 1707 / 2190 里最小的三块，旧 PR 不动。生产核实：8/25–9/22 基本没读到评论，10/9 起已恢复真回复。
