---
id: 2026-09-25-b2-simaqian-reputation-weekly
title: 司马迁口碑周巡上线：每周四自动读各客户新 Google 评价、起草回复和好评帖草稿进今日待办（署名司马迁），一律不发
status: decided
owner: agent
decided_on: 2026-09-25
source: session:121634d6
verify_by: 2026-10-09
verify_how: 合并后第二个周四（NZ 09:00）看 cron_run_logs 里 job_name=simaqian-reputation-weekly 有 status=completed 的行且 summary.clients 是数组；当周五早上今日待办邮件里出现「司马迁：」开头的条目或「司马迁本周没巡成」条目（有新评价的客户至少 1 家才算能判；全部 no_new_reviews 则只验第一条）
---
agent 自治计划 B2（docs/specs/2026-09-24-agent-autonomy-operating-plan-v1.md §4.1 司马迁），三只闹钟之一。
Inngest 云端函数 cloud-simaqian-reputation-weekly（周四 09:00 NZ，避开周五六），读 review_items.is_new（周一快照写的），Claude Haiku 起草，回执写 cron_run_logs；今日待办拉模式读回执（src/lib/pm-todo/simaqian-review-items.ts）。
不发帖、不回评（口碑 FDE-only、GBP 发帖审批制）；读不到 = read_failed 进系统欠账栏。
