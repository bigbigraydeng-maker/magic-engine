# 证据 · 2026-10-10-nm-medspa-ad-schedule-and-enddate · 2026-11-26
fetched_at: 2026-11-26T05:19:56+1300
查了什么：Meta 只读读回 NM Medspa 那个广告组的投放时段、结束时间；按广告主时区小时级花费（hourly_stats_aggregated_by_advertiser_time_zone）看 12:00–17:00 以外有没有花费。
数字：adset_schedule = 每天 7 天、start_minute 720、end_minute 1020、timezone_type ADVERTISER（=12:00–17:00 广告主时区），end_time = 2026-10-19T00:37:31+1300，与文档 §10 第二、三轮一致。2026-10-10 至 10-19 小时级花费：12 点 21.22 / 13 点 16.22 / 14 点 18.15 / 15 点 14.37 / 16 点 16.64 / 17 点 0.02 NZD，其余小时（含原来的 10–11 点）没有花费行。17 点那 0.02 是结束边界上的尾数（占总花费约 0.02%），记在这里给人看。
来源/命令：Meta 官方广告工具 ads_get_ad_entities，level=adset，object_ids=该广告组，time_range 10-10..10-19，breakdown=按广告主时区小时。
结论：成。时段和结束日期读回一致，时段外基本无花费（仅 17 点边界 0.02）。
