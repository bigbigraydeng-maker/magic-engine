---
id: 2026-10-05-site-audit-weekly-cap-and-stale-receipt
title: 每周网站体检上限从150页提到200页，并在运行记录里报"多少页超过10天没刷新"
status: decided
owner: agent
decided_on: 2026-10-05
source: session:83a5fc92
verify_by: 2026-10-12
verify_how: 合并后首个周日（含）自动体检跑完，查 cron_run_logs 里 site-audit-weekly 那条的 summary.results 每个客户都有 pages_stale_before_run 数字，CTS 一轮抓满（上限 200 ≥ 地图 179 页）。
---
配套 PR 2233（爬虫抓页面描述 + 最久没刷新优先）。这一条单独走，因为改的是生产定时任务路由，按规矩属 A 级。
