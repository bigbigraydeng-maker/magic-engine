---
id: 2026-11-10-ad-intraday-spend-sample-stall-monitor
title: 日内花费采样停了要进今日待办
status: done
owner: agent
decided_on: 2026-11-10
source: issue:3727
verify_by: 2026-11-15
verify_how: 合并后模拟 cron_run_logs 里该任务超过 60 分钟无 completed，今日待办 dev 栏出现一条中文说明；恢复正常后不再出现
---
读 cron_run_logs 的 ad-intraday-spend-sample；阈值与 agent-jobs 登记一致，出口复用 ads_agent_sync_stale（infra）。
