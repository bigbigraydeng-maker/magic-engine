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
真实事故：2026-09-20 East International 客户 24/24 探测全挂（OpenAI 余额用光 + Google 报错），
系统把"没测成"和"真的没被提到"混在一起，三天没人发现。

这次改动：新增 `ai_tracker_all_failed` 待办项——某客户整周探测全部失败时自动出现在今日待办里，
带原因分类（余额用光/授权失效/供应商出错）和修复指引；顺带修好旧的每周体检任务，
以前全挂的客户被算成"成功"，现在正确算失败；查询改用分页读取，避免数据量大了以后被
数据库悄悄截断漏看。

经子牙（架构）+ 魏征（挑刺）两轮独立复审，复审提的问题（分页截断）已修。PR
[#1943](https://github.com/bigbigraydeng-maker/magic-engine/pull/1943)，17 个新测试全过，
还没合并，等 CI 跑完点头。
