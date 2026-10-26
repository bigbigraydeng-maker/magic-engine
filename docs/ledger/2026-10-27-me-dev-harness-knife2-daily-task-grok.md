---
id: 2026-10-27-me-dev-harness-knife2-daily-task-grok
title: 总控台第二刀：每天早上自动把手机版页面发到 PM 手机，页面加「Grok 的活」一栏
status: decided
owner: agent
decided_on: 2026-10-27
source: doc:docs/specs/2026-10-26-me-dev-harness-design-v0.2.md
verify_by: 2026-11-03
verify_how: 连续 7 个早上（10-27 到 11-02）PM 手机都收到总控台页面，页面里没有窗口标题。收到 7 次且无标题=成；漏发任何一天或带标题=不成，先看定时任务 dev-console-daily-snapshot 的运行记录。另量一次每次运行的花费，超过 1 美元一次就改成两天一次。
---
定时任务 dev-console-daily-snapshot（每天约 8:34 新西兰时间，免审批模式）10-26 当场试跑成功，页面已发到手机。
Grok 一栏只读 GitHub 上 cursor/ 分支的 PR 数字：开着几个、最久几天没动、近 7 天合了几个、关掉没合几个，不放标题。
Grok 窗口里正在聊的内容读不稳，不进这一栏。
