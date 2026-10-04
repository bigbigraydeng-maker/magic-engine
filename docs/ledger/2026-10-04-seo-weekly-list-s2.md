---
id: 2026-10-04-seo-weekly-list-s2
title: CTS SEO 每周清单任务（周一自动出清单、核对、周报）已写好，等合并上线后看第一次自动运行
status: decided
owner: agent
decided_on: 2026-10-04
source: session:cdd5dbf9
verify_by: 2026-10-12
verify_how: 周一（10/5 04:30 UTC，若 Render 已同步）后查 cron_run_logs 里 seo-weekly-list 有成功记录，CTS 下出现 ≤5 张带 loop 标记的清单卡且每张有做什么/怎么做/链接；10/12 周报出现 SEO 清单栏；没跑则看 Render 是否同步了新定时任务
---
设计：docs/specs/2026-10-04-seo-weekly-list-v0.2.md（S2）。新定时任务要 Render 同步 blueprint 才会创建，不同步不会跑也不报错。
