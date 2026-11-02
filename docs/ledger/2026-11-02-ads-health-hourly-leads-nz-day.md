---
id: 2026-11-02-ads-health-hourly-leads-nz-day
title: 广告健康每小时进线：昨天/7日均用新西兰日历减日，不用 UTC 正午
status: done
owner: agent
decided_on: 2026-11-02
source: pr:3503
done_on: 2026-11-02
done_ref: pr:3503
---
Claude 复审：isoDayMinus 用 UTC 正午锚点导致 NZ 日界附近昨天/上周/7天均值错桶；已改为 promo-window.nzDayMinus。
