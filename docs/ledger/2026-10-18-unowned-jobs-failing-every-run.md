---
id: 2026-10-18-unowned-jobs-failing-every-run
title: 三个没人管的自动程序过去两周每次运行都失败——客户线索同步（缺 Facebook 主页权限）、ME 自己获客（谷歌地图账单没开）、行业基准累积（数据库缺一列）
status: decided
owner: agent
decided_on: 2026-10-18
source: session:c668eb35
verify_by: 2026-10-25
verify_how: 查 cron_run_logs 里三个程序最近 3 次是否转 completed。meta-leads-sync 要有人补 Magic Lab Class 与 NAL 两个客户主页的权限；prospecting-sweep 要谷歌云项目开账单（花钱，PM 决定）；benchmark-accumulator 要把缺的 growth_client_count 列补进 industry_benchmarks（数据库改动，A 级）。另查这三个失败有没有进今日待办——若没有，就是铁律 3 说的「发现死在日志里」
---
2026-10-18 正式库只读：14 天内 meta-leads-sync 168/168 次失败（3/7 个客户取不到线索，缺 Facebook 页面权限）；prospecting-sweep 336/336 次失败（谷歌地图接口要求开账单）；benchmark-accumulator 2/2 次失败（industry_benchmarks 表缺 growth_client_count 列）。
meta-leads-sync 失败期间仍处理了 1176 条，说明 4/7 个客户的线索是通的；失败的是另外几个。
三个都归「无主」，所以没人看它们的失败。闭环骨架 10-18 已经点名过 meta-leads-sync 连续失败不知道有没有进待办。
