---
id: 2026-10-07-cron-close-first-batch-pending-pm
title: 第一批 5 条没人读的定时任务（关 3、降 1、去重复 1）已出 A 级草稿 PR，等 PM 回「合」才生效
status: decided
owner: pm
decided_on: 2026-10-07
source: doc:docs/audits/2026-10-07-cron-data-readers-audit.md
verify_by: 2026-10-14
verify_how: PM 回「合」并合并后，Render 后台 job-boards-weekly、execution-auto-run、team-memory-sweeper 三项不再运行，行业 AI 可见度改为每周一；cron_run_logs 里三者最新一行停在合并日之前。
---
关停是改生产定时任务，A 级，只有 PM 本人回「合」才合并；不合则一切照旧。
行业 AI 可见度只降频不删（管理页可能还有人偶尔看）；healthchecks 那条心跳预期周期需 PM 在后台改成每周。
恢复方法：render.yaml 与 registry.ts 里对应注释取消即可。
