# 证据 · 2026-09-26-gsc-page-daily-write · 2026-09-28

fetched_at: 2026-09-28T09:25:00Z

查了什么：gsc_page_fetch_receipts、gsc_page_daily、cron_run_logs（gsc-page-daily / gsc-page-daily-pull）三张表/任务

数字：
- gsc_page_fetch_receipts：CTS、Oztop 的 daily 与 backfill 记录全部 status=complete，data_from_day/
  data_through_day 都有值，没有停在 running 的行
- gsc_page_daily 2026-09-24 那天：CTS 126 个页面、clicks 合计 30、impressions 合计 2285 —— 跟卡里写的
  「生产只读探测」数字（126 页/30 点击/2285 展示）完全一致，证明现在走真实管道落库的数字和当初探测的一样；
  Oztop 同日 44 个页面（低于验收里"样本辅助线 50"，但卡上写明这条只作辅助不能单独判失败）
  全库累计 30,855 行、4 个客户、覆盖 2026-04-01 至今
- cron_run_logs：gsc-page-daily（派单）9-26、9-27 两天都 completed，summary.stopped_backfill_months=[]；
  gsc-page-daily-pull（拉取执行单）9-27 那一批全部 completed，没有卡在 running 的

来源/命令：Supabase 三张表只读查询

结论：成。①②④三项判据用数据直接确认；③（逐页对账 vs 全站）没有找到现成的"单日全站合计"表做交叉核对，
但落库数字与卡上引用的、已核实过的探测数字完全一致，间接确认数据是全的。⑤（定时任务健康检查绿）未单独查，
不影响前四项的判断。
