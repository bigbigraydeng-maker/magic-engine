# 证据 · 2026-10-10-goal-monthly-rollover-v2 · 2026-11-20
fetched_at: 2026-11-20T08:59:35+1300
查了什么：生产库 goals 表里 primary_metric_key=messaging_started 或 recurrence 非空的目标；cron_run_logs 里 goals-expiry-check 最近两次运行。
数字（带样本量、两边取数状态）：goals 只有 2 条命中（两边取数都成功）——NAL 9 月一条、NAL 10 月一条（2026-10-01~10-31，目标 300，10-14 建），两条 recurrence 都是空、状态都是 expired；没有 11 月那条。goals-expiry-check 11-18、11-19 都跑成，summary 为 rollover_rolled: []、rollover_skipped_existing: 0。
来源/命令：Supabase 只读 SQL（项目 glbdnayojixmexgofbsd）：select … from goals where recurrence is not null or primary_metric_key='messaging_started'；select … from cron_run_logs where job_name ilike '%goal%'。
结论：不成——10 月目标补建了，但 recurrence 不是 monthly，11-01 之后也没自动出现 11 月目标，续建从没发生过。
