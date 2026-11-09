---
id: 2026-10-25-dated-leads-count-window
title: 有起止日期的线索目标，当前值只数这段时间里的广告线索
status: done
owner: agent
decided_on: 2026-10-25
source: doc:src/lib/strategy/auto-fetch.ts
verify_by: 2026-10-31
verify_how: 主干上 auto-fetch-leads-window 测试为绿；有起止日期的线索目标当前值不再等于目标开始前的网站转化合计
done_on: 2026-10-25
done_ref: pr:3141
---
取数改在 src/lib/strategy/auto-fetch.ts。有起止日期时先数广告线索，结束日收到今天，开始日之前不计入。没有日期时仍先读网站最近快照。
页面格子会标出来源是 Meta 线索。每日刷新走同一条取数，会写回这个数。
