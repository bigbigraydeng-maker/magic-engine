---
id: 2026-11-08-ads-monitor-i2-i3-gap
title: IMPACT I-2/I-3 广告监测断点进今日待办（日回拉局部失败 + 小时心跳停摆）
status: done
owner: agent
decided_on: 2026-11-08
source: batch:A-ray-1109
verify_by: 首次 pm-daily-todo 自动运行当天（7 天内）
verify_how: 合并后次日待办：有配置的心跳客户若超 3h 无成功采样出 dev 欠账；每日回拉 summary 里 ad_daily/ad_health 局部失败按客户出说明，且不吞已有同步过期提醒。
---

纯判据在 `monitoring/`；出口复用 `pushAdsAgentMonitorItems`，不新开 live、不写字表迁移。
