---
id: 2026-11-05-ads-watch-add-expansion-campaign
title: 每小时盯盘加入新开的扩量系列（之前只盯 3 个老系列）
status: done
owner: agent
decided_on: 2026-11-05
source: session:ca3e0d15
verify_by: 2026-11-06
verify_how: PR 合并部署后，读 cron_run_logs 里 ads-tracking-launch-watch 最近一次回执，objective_watch.series 里要出现扩量系列（4 个系列）；出现且无报错算成，没出现先查部署时间
done_on: 2026-11-05
done_ref: pr:3640
---
PM 11-05 回「加盯盘」。盯盘按系列编号逐个配置，新系列开投后不在名单里，没人盯它的花费、线索进 CRM、审核状态。
只暂停入口总开关当前是关的（30 天 41 次命中全是 switch_off），所以加盯盘不会误停广告；开关将来打开前，要先看两个系列日预算合计（约 NZ$200）和账户日上限（NZ$200）几乎相等的问题。
