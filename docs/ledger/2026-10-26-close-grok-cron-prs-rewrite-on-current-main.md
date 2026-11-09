---
id: 2026-10-26-close-grok-cron-prs-rewrite-on-current-main
title: 关掉 Grok 的 4 张定时任务 PR，真需要做的事按当前 main 重开
status: done
owner: pm
decided_on: 2026-10-26
source: session:9c08a71c
done_on: 2026-10-26
done_ref: pr:3167
verify_how: GitHub 上 PR 3076 3075 3074 3070 均为已关闭；重做的 PR 3167 3173 3174 3175 均为已合并（3070 等价工作 PM 决定不做）。
---
Grok Bot 10-24 开的 #3076 #3075 #3074 #3070，分支基线落后主干 185+ commit，期间主干重写了 cron registry 并新建 dispatch 中心、合并了 7 条独立 CI 工作流。PM 2026-10-26 选 A，4 张 PR 已关闭。四件事（cron 条目失败记账 / 执行管线僵尸 / 爆款分析重试 / 工厂扫描调度）按当前 main 现状分别开新小 PR 跟进。
