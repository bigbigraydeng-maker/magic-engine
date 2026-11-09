---
id: 2026-10-14-seo-patrol-daily-zombie-running-runs
title: SEO 每日巡检有两次运行长期停在「运行中」、多个日期没跑，需要开发排查
status: decided
owner: agent
decided_on: 2026-10-14
source: pr:2387
verify_by: 2026-10-21
verify_how: 查 cron_run_logs 里 seo-patrol-daily：没有超过 1 小时仍是 running 的记录，近 7 天每天都有一条成功记录；有就是还没修好
---
来源：日历巡检 2387 的证据文件 doc:docs/ledger/evidence/2026-09-26-seo-patrol-card-dedupe--2026-10-13.md 记录了两次僵尸 running 与多日缺失。
原卡 2026-09-26-seo-patrol-card-dedupe 只管卡片去重，本卡单独跟踪这个运行异常，需开发排查，不在本 PR 修。
