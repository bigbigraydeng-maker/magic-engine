---
id: 2026-10-06-site-audit-weekly-no-dry-run
title: 每周网站体检不支持"只演练不写入"，进不了当面试跑入口；决定这轮不做，改靠 10-11 真跑后核对
status: decided
owner: agent
decided_on: 2026-10-06
source: session:a83d869b
verify_by: 2026-10-12
verify_how: 10-11 周日体检真跑后，在生产只读查 CTS 的 client_site_pages：meta_description 有值页数应接近全部已体检页（合并前基线：167 页里 0 页有值），早于 10-04 抓取的页只剩已下架几页（基线 22 页）。不成：描述仍为 0，或旧页没变少——先看 10-11 那次任务是否 completed。与日历「查一下网站体检有没有开始记下每页的描述」同一天。
---
当面试跑入口的白名单（.github/workflows/manual-cron-trial.yml）没有 site-audit-weekly；它的路由没有读 dry_run，一跑就真抓真写，进白名单要 A 级改动且演练仍要真调抓取服务约 150–179 页。
统筹决定：体检本来就是要写库的任务，这轮不加演练模式，不进白名单；验证改为 10-11 真跑后只读对比基线。
