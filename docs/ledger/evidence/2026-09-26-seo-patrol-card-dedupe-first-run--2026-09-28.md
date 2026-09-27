# 证据 · 2026-09-26-seo-patrol-card-dedupe-first-run · 2026-09-28
fetched_at: 2026-09-28T01:45:00+13:00（只读 SQL 于 01:45–01:53 NZDT 取数）
查了什么：①cron_run_logs 里 job_name=seo-patrol-daily 最近一条（#2062 于 2026-09-26 10:42 UTC 部署后的第一次运行）；②execution_items 里这次运行开始之后新开的巡查卡（dimension='seo'、source='zhuge'、steps_json 带 rule_id、created_at ≥ 运行开始）；③这次运行里被标成 superseded 的巡查卡，按「标记时距创建是否不足 14 天」分组。
数字（带样本量、两边取数状态）：
- ①2026-09-27 04:01:04–04:06:28 UTC，status=completed，processed=10、completed_count=10、failed_count=0；summary.total_findings=152、total_actions=1（取数成功）。
- ②新开巡查卡共 1 张：CTS 的 /tours/china/discovery/china-icons-collection-christchurch（seo.refresh_blog，pending）——这一页以前被老去重键挤掉、从没开出过卡。CTS 的 china-tours-from-australia 没有新卡；Oztop 没有新卡（本周名额已满）。CTS 窗口内不同目标数 1 + 新开 1 = 2 ≤ 3（取数成功）。
- ③这次运行里被标 superseded 的巡查卡 2 张，其中「建了不到 14 天就被标」的 0 张——两张都是每日清理标掉的老卡（取数成功）。
- 对照：上线前一天（2026-09-26 04:00 UTC 那轮）total_actions=5。
来源/命令：Supabase 只读 SQL（项目 CrazyContent）：select … from cron_run_logs where job_name='seo-patrol-daily' order by started_at desc limit 1；select … from execution_items where dimension='seo' and source='zhuge' and steps_json ? 'rule_id' and created_at >= <运行开始>；select count(*) filter (where updated_at < created_at + interval '14 days') … where status='superseded' and updated_at >= <运行开始>。
结论：成——三项全对；另记：CTS 的 Christchurch 那页当天开出了第一张卡。
