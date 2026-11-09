# 证据 · 2026-09-26-seo-not-indexed-first-weekly-recrawl · 2026-09-28

fetched_at: 2026-09-28T09:32:00Z

查了什么：cron_run_logs job_name=site-audit-weekly；site_audit_jobs completed_at > 2026-09-26T03:04:28Z 的
error_message；client_site_pages crawled_at 晚于同一时间的 crawl_status 分布

数字：
- site-audit-weekly：2026-09-27 01:01 UTC 那次 status=completed，failed_count=0（合并部署后第一次每周重爬）
- site_audit_jobs：该时间之后 completed 的 2 个任务，error_message 全部为空（0 条非空）
- client_site_pages：crawled_at 晚于该时间的页面里，crawl_status=crawled 152 行、antibot_challenged 1 行——
  被挡的页面被正确标成 antibot_challenged，不是静默算失败或漏标

来源/命令：Supabase 三张表/日志只读查询

结论：成。三项判据全部满足：重爬跑完、没有任务带失败原因、被挡页面正确标出原因。
