---
id: 2026-11-02-ads-health-hourly-leads-nz-day
title: 广告健康每小时进线：昨天/7日均用新西兰日历减日，不用 UTC 正午
status: done
owner: agent
decided_on: 2026-11-02
source: pr:3503
verify_by: 2026-11-09
verify_how: 合并后 npm test -- hourly-meta-leads hourly-leads-forecast 与 hourly-leads route 全绿；nzDayMinus 对 2026-01-16 减 1 天得 2026-01-15；现在 16:30 时昨天 16:59 不计；全天区间不低于当天已观测总数；超过 1000 行仍读到今天，读不全则读不到。
done_on: 2026-11-02
done_ref: pr:3503
---
Claude 复审：isoDayMinus 用 UTC 正午锚点导致 NZ 日界附近昨天/上周/7天均值错桶；已改为 promo-window.nzDayMinus。
Codex 复审：28 天线索改 fetchAll（读不全则「读不到」）；昨天/上周同一时间截到新西兰时分秒；全天预测区间不低于今天已观测总数。
