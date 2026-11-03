# 证据 · 2026-10-13-gsc-query-page-daily-archive · 2026-10-14

fetched_at: 2026-10-13T14:15:00Z

查了什么：线上库的 gsc_query_page_fetch_receipts、gsc_query_page_daily、gsc_page_daily、cron_run_logs；手动入口 gsc-brand-split（CTS，只读）。只读，没触发任何任务。

数字：
- 第一批 20 单全部 complete（16 个回补月 + 4 个最近 5 天），没有 failed / truncated / running，没有超长键被跳过；拉取运行记录 20 条全部 completed，派单 1 条 completed。
- gsc_query_page_daily 共 48,753 行，日期 2026-07-01 到 2026-10-10；gsc_page_daily 仍是 47,210 行，页级链 10-12 照常 completed（没伤到在线链）。
- 每个客户每个共有日期，词级点击合计都不超过页级（超过的天数 = 0）。
- 词级点击占页级的比例：CTS 约 36%、另三个客户约 22% / 38% / 60%。**这是谷歌隐藏匿名词的真实水平，卡里原写的「至少 60%」下限是我估错的**（CTS 只有约 36%），请按本条理解第②项：判据应是「不超过页级，且各天都有数据」，不是 60%。
- 拆分入口 gsc-brand-split（CTS，窗口 09-11 到 10-08）：status=ok，两张表各 28 天、对齐，warnings 为空；品牌词 177 次点击、歧义词 25、非品牌 176；未归因 655（页级 1,033 − 词级 378）。
- 探针在建表之前跑过（2026-10-12，CTS 近 7 天 2,624 行、平均每天 375 行）。

来源/命令：Supabase 只读查询；GitHub 手动试跑工作流 gsc-brand-split。

结论：①成 ③成 ④成 ⑤成；②的上限成立、下限那半句作废（见上）。回补还剩更早的月份，随后几天每天自动补 4 个月，补满前的核对由夜巡按卡继续看。
