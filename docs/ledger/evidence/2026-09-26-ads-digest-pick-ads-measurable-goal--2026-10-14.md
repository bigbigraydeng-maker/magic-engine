# 证据 · 2026-09-26-ads-digest-pick-ads-measurable-goal · 2026-10-14
fetched_at: 2026-10-14T21:40:59+13:00

查了什么：上线后的 CTS 广告日报，「目标进度」段显示的到底是哪个目标 —— 留资目标，
还是「没有生效中的目标」/ 报名目标。

数字（带样本量、两边取数状态）：
- 日报的目标进度段落逐日落在生产表 ads_growth_states（payload->'goal' + goal_pace 两列）。
  CTS 共 19 天的记录，最早 2026-09-24、最新 2026-10-13。
- 合并上线（2026-09-26）后的第一条记录 2026-09-26：payload.goal.label = 「留资数」，
  pace.actualToDate = 29 —— 既不是「没有生效中的目标」，也不是报名目标。
  之后 2026-09-27 / 09-28 / 09-29 同样是「留资数」（actualToDate 45 / 56 / 66）。
- 最近三天（2026-10-11 / 10-12 / 10-13）依然是「留资数」目标，带完整数字：
  title = 「CTS 圣诞团 + Golden China 招募 · 留资先导指标（到 2026-11-30）」、target=180、
  pace.verdict=behind、actualToDate 18 / 18 / 19。全量 19 天没有一天落到报名目标或空目标。
- 同期生产库里 CTS 确实有 3 个进行中目标，且最新建的那个是 seo_gsc_clicks_28d（不是广告能量到的指标），
  正是这张卡要修的场景；代码 src/lib/ads-strategy/portfolio/goal-context.ts 的 pickDigestGoal
  在主干上按 ADS_ATTRIBUTABLE_METRIC_KEYS = {leads_count, messaging_started} 挑，跟库里的实际结果一致。

来源/命令：
- Supabase 只读 SQL（生产项目 glbdnayojixmexgofbsd）：
  select date, payload->'goal'->>'label', payload->'goal'->'pace'->>'actualToDate' from ads_growth_states where client_id=<CTS> order by date asc limit 5
  select date, goal_pace, payload->>'goal' from ads_growth_states where client_id=<CTS> order by date desc limit 3
  select title, primary_metric_key, created_at from goals where client_id=<CTS> and status='active' order by created_at desc
- gh pr view 2056 --json files（确认改动范围 = goal-context.ts + 其测试 + 本卡）
- 主干文件 src/lib/ads-strategy/portfolio/goal-context.ts:23,30（挑选规则）

结论：成。上线当天那份日报起，目标进度段一直显示留资目标并带真实数字，19/19 天都没退回报名目标或空目标。
