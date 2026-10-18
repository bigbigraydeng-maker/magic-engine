# 证据 · 2026-09-27-nal-client-status-active · 2026-10-15
fetched_at: 2026-10-15T21:33:22+1300
查了什么：NAL(4ae76381…) 的 client_status、每周任务是否处理到 NAL、目标当前值。
数字：clients.client_status=active；keyword_snapshots 里 NAL 最新一行 created_at=2026-10-12T02:02:02Z（keyword-snapshots-weekly 当次 processed=10、failed=0）；goals 里 NAL 当前 active 目标周期 2026-10-01~2026-10-31，current_value=171，current_value_fetched_at=2026-10-14T17:31:26Z；goal-current-value-refresh 10-10 至 10-14 每晚 status=completed。
附注：ai-tracker-weekly 10-11 那轮 processed=8 但 failed_count=8（全部失败，非 NAL 独有，不在本卡范围）。
来源/命令：supabase REST 只读 GET clients / keyword_snapshots / goals / cron_run_logs
结论：成。NAL 已不再被定时任务跳过，目标当前值不再是 null。
