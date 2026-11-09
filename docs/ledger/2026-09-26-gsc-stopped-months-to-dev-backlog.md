---
id: 2026-09-26-gsc-stopped-months-to-dev-backlog
title: 开发欠账清单（#2065）合并后，接上读谷歌逐页补历史的「停派月份」，让停派的月份进清单
status: decided
owner: agent
decided_on: 2026-09-26
source: pr:2068
verify_how: 开发欠账清单（PR 2065）合并并接好后，找一行 summary.stopped_backfill_months 不为空的 gsc-page-daily 派单记录（生产没有就在测试库造一条），开发欠账清单里能看到对应的客户和月份；清单跟着每天的派单行更新，那个月有了 complete 或 truncated 回执后从清单消失。只在代码里「声明了字段」不算，要在清单里真看得到
---
来自第 4 条 PR-A（#2068）复审 W68-3：补历史某个月连续 3 次非授权失败后停派，派单行只在第一次看到那天报红，之后每天在 summary.stopped_backfill_months 列出全部仍停派的月份。
这属于开发欠账，不进 PM 的今日待办（PM 2026-09-26 拍板今日待办只留 5 类）。#2065 合并之前，定时任务健康检查的红灯是唯一有人看的地方。
