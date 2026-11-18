# 证据 · 2026-10-10-nm-medspa-ad-schedule-and-enddate · 2026-11-19
fetched_at: 2026-11-19T06:19:24+13:00
查了什么：Meta 只读接口读回那个广告组的投放时段与结束时间，再按广告主时区读小时级花费。
数字（带样本量、两边取数状态）：adset_schedule = 每天 start_minute 720 / end_minute 1020 / timezone_type ADVERTISER（=12:00–17:00 广告主时区），end_time = 2026-10-19T00:37:31+1300，与文档 §10 第二、三轮写的一致。10-11~10-19 按 hourly_stats_aggregated_by_advertiser_time_zone 拆：12 点 15.13、13 点 16.20、14 点 17.87、15 点 14.34、16 点 16.64、17 点 0.02（NZD，合计 80.20）；0–11 点和 18–23 点无花费行。取数成功。
来源/命令：ads_get_ad_entities level=adset（字段 adset_schedule,end_time；breakdown hourly_stats_aggregated_by_advertiser_time_zone，time_range 2026-10-11~2026-10-19）。
结论：成——时段与结束日期与文档一致；窗口外只有 17 点那格 NZ$0.02（占 0.025%，时段边界的投放滞后），其余窗口外小时零花费。
