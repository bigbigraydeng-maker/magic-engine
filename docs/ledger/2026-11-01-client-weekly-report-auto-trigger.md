---
id: 2026-11-01-client-weekly-report-auto-trigger
title: 客户每周浏览总结已做成每周四早上自动触发，目前只开给 Parkhomes、只发公司内部待审邮件，合并部署后要去 Inngest 后台同步一次
status: decided
owner: pm
decided_on: 2026-11-01
source: pr:3451
verify_by: 2026-11-06
verify_how: 看 11 月 5 日（周四）新西兰 8:30 那次自动运行：cron_run_logs 里 job=client-weekly-report 有一条 completed，summary 里 no_client_send=true；公司邮箱收到一封待审邮件；没收到就先查 Inngest 是否同步过
---
PR 3451（草稿，A 级，要 PM 点头才合）：每周四新西兰 8:30 触发，只处理 seo_config.client_weekly_report_enabled=true 的客户。
目前只有 Parkhomes 开了这个开关；开关默认关，没开的客户一个都不会处理。
这条链路没有任何发给客户的路径；给客户发信要 PM 单独授权，目前仍是 PM 审过后手动发。
当场试跑已做：选人只选到 Parkhomes，生成周报并发出内部待审邮件；还没做的是 Inngest 真正按时触发（要合并部署并同步后才会有）。
