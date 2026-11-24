---
id: 2026-11-23-inngest-jobs-stopped-nov10-20-not-investigated
title: 4 个广告/回传自动任务在 11-10 到 11-20 之间先后停了，PM 11-23 回「先不用」查，暂缓
status: decided
owner: pm
decided_on: 2026-11-23
source: session:6310fdee
verify_how: PM 定下要查之后：在生产库 cron_run_logs 看这 4 个任务（ad-heartbeat / ad-breakdown-capture / conversion-daily-pipeline / ads-tracking-launch-watch）是否重新每天都有运行记录；4 个都恢复才算成，有一个没恢复就查它为什么停
---
详细记录（原卡正文，原样未改）在 doc:docs/ledger/notes/2026-11-23-inngest-jobs-stopped-nov10-20-not-investigated.md。
