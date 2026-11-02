---
id: 2026-11-03-ads-d7-outcome-config-not-in-pm-todo
title: 广告「结果怎么算没设置」这类 D7 问题不进今日待办，4 个客户挂了快 30 天没人处理（管道断头）
status: done
owner: pm
decided_on: 2026-11-03
source: session:f765a75f
verify_by: 2026-11-10
verify_how: 查近 30 天一直命中 D7 的账户，看是否出现在 pm-daily-todo 当天邮件里；出现且有直达链接才算接上，样本至少 3 个账户
done_on: 2026-11-03
done_ref: pr:3530
check_note: 修法 PR 3530 已合并；不在投客户的噪音另由 2026-11-03-ads-d7-outcome-reminder-spending-only 处理
---
代码核实：今日待办只收 D2/D3/D10/D11 和「没登记主页」，D7 的人工任务只进内部日报邮件和广告健康页（pm-todo/ads-rule-finding-items.ts）。
生产库：近 30 天有 4 个账户的「广告结果怎么算没设置」每天都命中，平均挂 28.8 天；另有 1 个账户「设置显示在投但日数据停更」挂 29 天。
没设置结果口径，D3/D5 这两条规则在这些账户上一直判不了。修法是把 D7 并入现有的 ads_rule_finding 待办（不新增待办种类），等 PM 点头。
