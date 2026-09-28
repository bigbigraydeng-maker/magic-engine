---
id: 2026-09-27-goal-monthly-rollover
title: 每月自动开下一月的月目标，防止 NAL 及后续所有按月循环客户在自然月末失去投放口径
status: done
owner: agent
decided_on: 2026-09-27
source: session:8ef3266e
verify_by: 2026-10-02
verify_how: 迁移上线后 curl `/api/cron/goals-expiry-check?dry_run=1` 带 CRON_SECRET，返回 200 且无错 = 迁移和查询都生效。若 PM 已把 NAL 那条 9 月目标 flip 到 recurrence='monthly'，10-01 触发（GitHub Actions .github/workflows/goals-expiry-check.yml，声明 03:30 UTC，实测会飘，别拿没到 03:30 就当没跑）后查 goals 表应多一条 client=NAL、primary_metric_key=messaging_started、period_start=2026-10-01 的 active 目标，current_value=null。查不出先看 cron_run_logs 表 goals-expiry-check 那行的处理数（该行成功时 summary 字段会列出这次续了哪些客户）、再看那个 workflow 文件的 Actions 运行记录是否真跑。
done_on: 2026-09-27
done_ref: pr:2194
---

起因：goals-expiry-check cron 只把 active 目标 flag 成 expired，不会创建下一周期；NAL 9/24 起是 PM 授权的广告全权自治，10/1 会失去目标口径。设计（PM 9/27 拍板加字段）：goals 表加 recurrence 列（'monthly' 或 NULL）+ 部分唯一索引兜幂等；cron 后半段扫 recurrence='monthly' + period_end<today 的目标，按自然月造下一条。代码 src/lib/strategy/goal-rollover.ts；cron 支持 `?dry_run=1`。17 个单元测试 + 本机 Postgres 17 沙盘 6 项断言全绿。
子牙 + 魏征两轮审查（PR #2194）：零 BLOCKER，测试独立重跑证实为真。子牙点出关键缺口——这个 PR 只造了续期机器，没有任何 UI/API 能把 recurrence 设成 monthly，NAL 必须手工 SQL 才能挂上；已建日历提醒 2026-09-30 09:00 核实。已按审查意见修正：调度注释（真实是 GitHub Actions 03:30 UTC 会飘，非 render.yaml 03:00）、脏日期未捕获异常兜底、续期成功明细回写 cron_run_logs.summary、客户中途流失需手工同时清 recurrence 的说明。
