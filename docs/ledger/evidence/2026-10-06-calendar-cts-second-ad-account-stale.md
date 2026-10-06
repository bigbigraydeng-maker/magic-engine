# 日历巡检证据：查一下广告数据时区修好后有没有真的多拿一天（含 9/23 补没补上）

- fetched_at: 2026-10-06（新西兰时间 21:50 前后）
- 方式：只读查生产库（Supabase SQL 只读）
- 日历事件：查一下广告数据时区修好后有没有真的多拿一天（含 9/23 补没补上）

- SQL：ad_daily_insights 按 level、ad_account_id 分组取 max(insight_date) 及 9/23、9/24 行数（client=CTS）
- 主账户（尾号 7274）：三层级最新 2026-10-05，9/23 行数 10/2/2，9/24 行数 9/2/2，达标
- 第二账户（尾号 0470）：三层级最新 2026-09-22，9/23 和 9/24 均 0 行，未达标
- cron_run_logs google-data-pullback-daily：9/22 起 14 次全部 failed，最近报错为 Oztop 等客户 Meta getAdAccountInsights empty_data，不是 CTS
- 结论（已核实）：docs/clients/cts/2026-10-06-remotion-video-ad-plan.md 记录该账户最后一笔花费在 9/22，六个广告组当前都无花费；9/23 起无花费 = 正常，不是补数遗漏，无需 PM 再核查，故不再登记待办卡
