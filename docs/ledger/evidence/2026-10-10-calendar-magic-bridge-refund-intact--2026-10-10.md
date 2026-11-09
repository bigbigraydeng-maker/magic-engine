# 证据：2026-10-10-calendar-magic-bridge-refund-intact · 取数 2026-10-10（NZ 时间，日历巡检只读核实）

日历事件：查一下 CTS 的 Magic Bridge 免费额度是不是还在退款后的位置
fetched_at: 2026-10-10 NZ，Supabase 只读 SELECT
查询：select period_key,cap_usd,reserved_usd,spent_usd,updated_at from meta_ads_ai_sponsored_budgets where client_id=CTS order by period_key desc limit 2
结果（样本 1 行）：period_key=2026-09，cap_usd=1.25，reserved_usd=0，spent_usd=0.082714，updated_at=2026-09-26 03:09 UTC；没有 10 月行。
结论：spent_usd 仍是退款后的 0.082714（9/26 之后没有新生成报告扣费）、没超上限、没有卡住的预留，三条成立。
