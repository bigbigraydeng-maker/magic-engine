# 证据 · 2026-09-26-seo-memory-reconcile-first-run · 2026-09-28
fetched_at: 2026-09-28T01:45:00+13:00（只读 SQL 于 01:45–01:53 NZDT 取数）
查了什么：①cron_run_logs 里 job_name=memory-extractor 最近一条（#2052 于 2026-09-26 13:13 UTC 部署后的第一次运行）；②它的 summary.deactivated 条数与 summary.deactivated_by_reason 是否一致、原因是否只在允许的几类里；③client_proven_patterns / client_failed_experiments 里 AI 可见度与社媒的在用行数，对照运行前（2026-09-26 13:16 UTC 只读取数：geo 有效 19、ai_visibility 失败 33、social 失败 1）。
数字（带样本量、两边取数状态）：
- ①2026-09-27 06:30:57–06:31:12 UTC，status=completed，processed=5、completed_count=5、failed_count=0；skipped_attribution_stalled=0（取数成功）。
- ②summary.deactivated 是 213 条的清单；deactivated_by_reason = no_execution_evidence 165 + site_level_metric 28 + source_missing 16 + preference_no_support 4 = 213，一致；没有别的原因。与合并前估算（SEO 有效 112 / 失败 89 / 偏好 4 = 205，广告有效 5 / 失败 3 = 8，合计 213）一条不差（取数成功）。
- ③运行后在用行数：proven_patterns geo 19（前 19）、failed_experiments ai_visibility 33（前 33）、social 1（前 1），都没变；SEO 有效 112→0、失败 89→0，广告有效 5→0、失败 3→0（取数成功）。
来源/命令：Supabase 只读 SQL（项目 CrazyContent）：select status, processed, completed_count, failed_count, jsonb_array_length(summary->'deactivated'), summary->'deactivated_by_reason' from cron_run_logs where job_name='memory-extractor' order by started_at desc limit 1；select 表, flywheel/dimension, count(*) filter (where is_active) from client_proven_patterns / client_failed_experiments group by 1,2。
结论：成——三项全对。
