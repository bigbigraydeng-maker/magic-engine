---
id: 2026-11-24-external-data-pull-allowlist-first-run
title: 外部数据拉回白名单首次自动运行核对（#3928 当场跑不了：要合并部署后生产 cron 才会真跑）
status: decided
owner: agent
decided_on: 2026-11-24
source: pr:3928
verify_by: 2026-12-01
verify_how: 合并部署后任选一条已改 cron（建议 meta-leads-sync 或 google-data-pullback-daily）跑完一轮，查 cron_run_logs：非 CTS 客户 processed=0 或不在 summary.results 里；CTS 仍 processed>0。默认未设 EXTERNAL_DATA_PULL_CLIENT_IDS 时仅 CTS 过闸。
---
当场跑不了原因：改动在数十条生产 cron/Inngest roster，需要 CRON_SECRET 与生产库；云代理不能对生产发 Bearer 试跑。