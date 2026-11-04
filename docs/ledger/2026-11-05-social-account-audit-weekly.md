---
id: 2026-11-05-social-account-audit-weekly
title: 社媒账号自检每周一新西兰 06:00 自动跑一次，结果写回执，今日待办每个有问题的客户出一条「账号自检」摘要（只读、不外发、不花钱）
status: decided
owner: agent
decided_on: 2026-11-05
source: doc:docs/specs/2026-11-05-social-agent-account-self-check-loop-v0.1.md
verify_by: 2026-11-09
verify_how: 合并部署 + Inngest Sync 后，手动发一次 social/account.audit.due {clientId: CTS, asOf: 2026-11-05}，cron_run_logs 里 job social-account-audit 有一行 completed、no_publish=true，clients[0] 的 metrics 里模板集中度 / BGM 重复 / 改版扎堆 / 形式覆盖 / 视觉单一为 over、内容柱配比为 not_measured；今日待办出现「账号自检」一条；2026-11-09 周一 06:00 新西兰那次定时运行有一行 completed、failed_count 0
---
对应设计 §4、§5。只读：读工单、写自己的运行记录，不写业务表。A 档处方（排期纠偏）是 2.5b，本卡不含；本卡只负责「每周量一次 + 给人看一条摘要」。待办归「review」栏，每个客户最多一条，只读最近 8 天内最新一行回执；客户没问题（没有超线也没有量不出来）就不出。
