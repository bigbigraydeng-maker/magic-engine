---
status: done
topic: monthly-report-ads-section
---

# 客户月报 · 付费广告只读板块（L2）

## 做了什么

- `src/lib/reports/monthly-ads-section.ts` 从 `ad_daily_insights`、`ad_entity_snapshots`、`ad_strategy_configs`、CRM（合格阶段 + `contact_stage_events`）、`flywheel_actions` / `flywheel_outcomes` 汇总当月广告块。
- 挂进既有 `buildMonthlyReport`（`src/lib/reports/monthly-aggregator.ts`），月报页与 HTML 导出展示中文摘要；缺数据写进 `gaps`，不编默认值。

## 验收

- `npm test -- src/lib/reports/__tests__/monthly-ads-section.test.ts`
- `npm test -- src/app/dashboard/reports/[clientId]/monthly/__tests__/page.test.tsx`

## 不做

- 无 migration / 新表 / 不动 `boundaries.ts`、预算卡、winner sync、pause card、告警代码；不调 Meta、不写生产库。
