---
id: 2026-09-23-ai-tracker-100pct-failure-pm-todo-alert
title: 客户 AI 可见度体检整周全挂时进 PM 待办告警——代码写完、两轮复审已过，PR 待合
status: decided
owner: pm
decided_on: 2026-09-23
source: session:963c2e80
verify_by: 2026-09-30
verify_how: "查 PR 1943 是否已合并；合并后到了下周一 AI 体检跑完，找一个探测全挂的客户（或人为制造一次），确认待办邮件里真的出现了这条提醒，而不是一片空白"
---
真实事故：2026-09-20 East International 24/24 探测全挂，但看起来跟「没被提到」一模一样，三天没人发现。
改动：新增 `ai_tracker_all_failed` 待办项自动报警（带原因分类和修复指引）+ 修好旧周检的失败计数
+ 查询加分页防止数据量大了被静默截断。经子牙（架构）+ 魏征（挑刺）两轮独立复审，问题已修，
17 个新测试全过。PR 1943，还没合并，等 CI 点头。
