---
id: 2026-11-08-ads-monitor-i2-i3-gap
title: IMPACT I-2/I-3 广告监测断点进今日待办（日回拉局部失败 + 小时心跳停摆）
status: done
owner: agent
decided_on: 2026-11-08
source: pr:3661
done_on: 2026-11-09
done_ref: pr:3669
verify_by: 2026-11-16
verify_how: 合并后次日待办：已配置心跳客户若超过 3 小时无成功采样，出开发欠账；每日回拉局部失败按客户出说明，且不吞已有同步过期提醒。
---

纯判据在 monitoring/；出口复用 pushAdsAgentMonitorItems。来源是已合并的同步过期提醒。本卡完成指针是本 PR。
