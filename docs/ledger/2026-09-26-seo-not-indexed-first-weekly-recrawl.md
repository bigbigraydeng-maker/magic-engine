---
id: 2026-09-26-seo-not-indexed-first-weekly-recrawl
title: 「没收录提醒说对原因」（第 2 条）上线后第一次每周重爬当天核对：重爬跑完、被挡页标上、标记失败时原因写进任务
status: done
owner: agent
decided_on: 2026-09-26
source: pr:2040
done_on: 2026-09-26
done_ref: pr:2040
verify_by: 2026-09-27
verify_how: 2026-09-27 01:00 UTC 的每周重爬（site-audit-weekly）及其抓取任务跑完后查三件事：①cron_run_logs 里 site-audit-weekly 最近一条 status=completed；②site_audit_jobs 里 completed_at 晚于 2026-09-26T03:04:28Z 的任务 error_message 全为空（不为空时里面就是标记失败的第一个原因）；③client_site_pages 里 crawled_at 晚于同一时间、仍被防火墙挡住的站点，crawl_status=antibot_challenged 的行数 > 0（该站已放行、抓到的是真内容则不算失败）。三项全对算成
last_checked: 2026-09-27
check_note: 判不了：每周重爬 9-27 01:00 UTC 才跑，夜巡跑时（9-26 14:50 UTC）还没到
---
PM 2026-09-26 定的硬规矩：以后才自动跑的功能，交付前要当场试跑；跑不了的开卡，验收日 = 第一次自动运行当天。
#2040 在 2026-09-26 03:04 UTC（数据库改动先上）合并、03:07 UTC 部署。当时本窗口还不知道这条规矩，没有当场试跑；每周重爬要真去读客户网站、只能等定时触发，所以补开本卡。PM 日历另有 9/28 09:00 的同内容提醒。
