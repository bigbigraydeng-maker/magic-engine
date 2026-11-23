---
id: 2026-11-21-ads-trend-check-patrol-wiring
title: 日趋势 Check 接卫青巡察与今日待办（开关默认关）
status: done
owner: agent
decided_on: 2026-11-21
source: pr:3907
verify_how: 合并后跑 `npm test -- src/lib/ads-strategy/trend-check src/lib/ads-strategy/agents/__tests__/patrol.test.ts src/lib/pm-todo/__tests__/ads-trend-check-items.test.ts`，退出码 0；开关关时 patrol payload 无 trendCheck，开关开时含结论行与待办项。
done_on: 2026-11-21
done_ref: pr:3907
---
`leads_config.ads_trend_check` 为 true 或 `{ enabled: true }` 时，日拉数后 `buildGrowthState` 写 `payload.trendCheck`、结论行、待办与广告门经营视图栏；含 `ads_tune_trend_v1` 供后续 Tune。无新表、不自动改广告。