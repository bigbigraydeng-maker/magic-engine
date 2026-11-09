---
id: 2026-10-18-diagnostic-narratives-save-fix
title: 体检「AI 文字叙事」从来没存进去过，修保存、补回执、改限流
status: decided
owner: agent
decided_on: 2026-10-18
source: session:2cd3c621
verify_by: 2026-10-20
verify_how: 10-19 周一 08:00 UTC 的每周体检跑完后：表 diagnostic_narratives 里有 10-19 那几轮体检的叙事行（以前一直是 0 行），且 cron_run_logs 里 diagnostic-weekly 当天各客户 outcomes 带 synthesis.state=ok；若 state 是 failed/partial，今日待办里应出现「体检叙事没写成」一条（开发欠账栏），先看它写的首个原因。
---
根因：保存叙事用的写法（ON CONFLICT 三列）对不上库里只有的「表达式唯一索引」，每次必报 42P10，错误被吞；限流又依赖这张空表所以从不生效。
本 PR：保存改成先删后插；限流改数「近 24 小时是否已有完成的体检」；失败写进每周任务回执并进今日待办。证据与费用估算见 PR 正文。
