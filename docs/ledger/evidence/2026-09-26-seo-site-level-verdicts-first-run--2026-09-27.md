# 证据 · 2026-09-26-seo-site-level-verdicts-first-run · 2026-09-27
fetched_at: 2026-09-27T03:52:51+13:00
查了什么：①cron_run_logs 里 attribution-cron 在 #2044 部署（2026-09-26 03:10 UTC）之后的运行；②flywheel_outcomes 里 computed_at > 2026-09-26T04:00Z 的整站 SEO 行的 verdict / confidence 分布。
数字（带样本量、两边取数状态）：
- ①部署后两轮都成功：2026-09-26 06:01 UTC 与 12:00 UTC，status=completed，summary.gsc.errors=[]，outcomes_written=666，clients_processed=4，pass1.failed=0（取数成功）。
- ②整站 SEO 行（metric_key ∈ seo.gsc.clicks/impressions/avg_position 或以 seo.domain./seo.ga4. 开头）共 666 行，全部 verdict=inconclusive、confidence=0；没有任何其它 verdict 的行（取数成功）。computed_at 落在 12:07–12:10 UTC（最近一轮覆盖写）。
来源/命令：Supabase 只读 SQL（项目 CrazyContent）：select … from cron_run_logs where job_name='attribution-cron'；select verdict, confidence, count(*) from flywheel_outcomes where computed_at > '2026-09-26T04:00:00Z' and (<整站 SEO 条件>) group by 1,2
结论：成——归因真跑成功且整站 SEO 结论全部是「判不了」、信心 0。
