# 证据 · 2026-09-29-ads-config-read-failure-other-callers · 2026-11-21
fetched_at: 2026-11-21T08:04:07+1300
查了什么：卡上三件事。①近 7 天所有定时运行记录里有没有 config_read_failed ②近 4 天 ads_growth_states 每天有几个客户有行、目标进度是否正常 ③近 7 天运行记录里有没有 ad_strategy_configs read failed。
数字（带样本量、两边取数状态）：取数成功。① 近 7 天 cron_run_logs 中含 config_read_failed 的记录 0 条。② ads_growth_states 11-17/18/19 各 6 个客户有行、11-20 有 5 个；有目标的那个客户 goal_pace 每天一行，verdict=on_track，正常。③ 近 7 天含 ad_strategy_configs read failed 的记录 0 条。每日回拉（kpi-backfill）近 3 天跑了 3 次。
来源/命令：Supabase 只读 SQL（cron_run_logs summary 文本匹配；ads_growth_states 按 date 分组）。
结论：成。三件事都正常；读失败那条报警链路没遇到真实故障，仍属「未经真实故障验证」，这次没模拟（模拟要改生产配置，需 PM 授权）。
