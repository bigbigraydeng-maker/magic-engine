# 证据 · 2026-09-26-goal-refresh-multi-active-goals · 2026-10-14
fetched_at: 2026-10-14T21:40:59+13:00

查了什么：①CTS 留资目标的当前值有没有数字、是不是自动刷的；②运行记录里失败/取不到数的目标有没有带原因、状态是不是不再全绿。

数字（带样本量、两边取数状态）：
- CTS 当前有 3 个进行中目标（正是这张卡的根因场景：一个客户多个目标），最近一次自动刷新
  2026-10-13 17:31 UTC 全部按自己的时间段取了数：
  · 留资目标（leads_count，周期 2026-09-24→2026-11-30）：当前值 19，来源 auto.cron，取数时间 2026-10-13 17:31:29 UTC
  · 自然搜索点击目标（seo_gsc_clicks_28d，周期 2026-10-05→2027-01-03）：当前值 1033，来源 auto.cron，同一轮
  · 报名目标（signups_count）：当前值为空 —— 卡正文已写明这是既有设计（库里还没有成交记录）
- 运行记录 cron_run_logs job_name=goal-current-value-refresh 最近两轮（2026-10-13 17:31、2026-10-12 17:31）：
  processed=3、completed_count=2、failed_count=0，summary 里 errors=[] 且 no_data 有一条带中文原因的记录，
  goal_id 经回查确认就是那个 signups_count 目标。
  → 「3 个里只完成 2 个，第 3 个带原因列出来」= 状态不再全绿、原因不再只打在控制台。

来源/命令：Supabase 只读 SQL（生产项目 glbdnayojixmexgofbsd）：
- select title, primary_metric_key, current_value, current_value_fetched_at, current_value_source, period_start, period_end from goals where client_id=<CTS> and status='active'
- select started_at, status, processed, completed_count, failed_count, summary from cron_run_logs where job_name='goal-current-value-refresh' order by started_at desc limit 2
- select primary_metric_key from goals where id=<summary.no_data[0].goal_id>

结论：成。两半都达标：多目标各自按自己周期刷出了数字，取不到数的那个在运行记录里带原因可见。
