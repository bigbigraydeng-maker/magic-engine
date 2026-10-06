# 日历巡检证据：复查 CTS 留资表单广告的成本有没有回落

- fetched_at: 2026-10-06（新西兰时间 21:50 前后）
- 方式：只读查生产库（Supabase SQL 只读）
- 日历事件：复查 CTS 留资表单广告的成本有没有回落

- SQL：select entity_name, sum(spend), sum(leads) from ad_daily_insights where client_id=CTS and level='campaign' and insight_date between '2026-09-24' and '2026-09-26' group by 1
- 结果：Reborn 20260624 花费 226.75、留资 18；Retargeting Warm 花费 143.56、留资 11
- 结论：Reborn 每留资 12.60，标准是 ≤10，未达标。样本：3 个自然日、1 条广告系列。
