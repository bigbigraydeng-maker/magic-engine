# 证据 · 2026-09-26-nal-meta-connection-stopgap · 2026-10-15
fetched_at: 2026-10-15T21:33:22+1300
查了什么：生产库 cron_run_logs 里 meta-leads-sync（每 2 小时一轮）最近几轮对 NAL 的结果。
数字：2026-10-15 08:25、06:25、04:25、02:25、00:25 UTC，以及 10-14 22:25 UTC 共 6 轮，每轮 NAL 条目都是 skipped=page_not_verified、error「主页绑定没核实，线索同步已暂停（unverified_shared_token）」，status=failed。
来源/命令：supabase REST 只读 GET cron_run_logs?job_name=like.*ads*（取 meta-leads-sync 行的 summary.results）
结论：不成。卡上 verify_how 写「还没人点或点了仍为 0 → failed」；到今晚主页仍未核实、留资同步仍被自家闸拦住，止血没让 NAL 恢复同步。
