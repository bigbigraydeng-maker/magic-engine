---
id: 2026-10-25-ads-account-probe-first-run-check
title: 账户状态探测首次自动运行核对（#3128 当场跑不了：要合并后 cron 才会跑）
status: decided
owner: pm
decided_on: 2026-10-25
verify_by: 2026-10-28
verify_how: 合并后首次 meta-leads-sync 自动运行，看 cron_run_logs.summary.accountStatusProbe：accounts>0、timedOut=false；rateLimited 若>0 记下。
---
当场跑不了原因：探测挂在生产 cron 上，要合并部署后才会真跑；本会话无法触发生产 cron。
