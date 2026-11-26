---
id: 2026-11-21-ads-daily-trend-check-rules
title: 日趋势 Check 纯函数规则引擎（PR-2 规则层）
status: done
owner: agent
decided_on: 2026-11-21
source: pr:3830
verify_how: 合并后跑 `npm test -- src/lib/ads-strategy/trend-check`，退出码 0；组 A 脱敏夹具在 2026-11-05～11-10 内至少一日命中 `creative_fatigue`，11-04 及更早不命中。
done_on: 2026-11-21
done_ref: pr:3830
---
`src/lib/ads-strategy/trend-check/` 纯函数 + 脱敏夹具验收窗 11-05～11-10；`leads_config.ads_trend_check` 阈值无新列。巡察接线另 PR。