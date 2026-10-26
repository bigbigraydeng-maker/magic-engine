# 证据 · 2026-09-26-seo-weekly-snapshot-gate · 2026-10-14
fetched_at: 2026-10-14T21:40:59+13:00

查了什么：三项验收判据全部在生产库重新取数（不沿用 9-28 / 10-09 夜巡的旧结论）。

数字（带样本量、两边取数状态）：
- ① cron_run_logs job_name=flywheel-seo-weekly 最近一轮 = 2026-10-11 16:15 UTC（week_key 2026-W42）：
  派发记录 status=completed / clients_dispatched=2；两条单客户记录都是 status=completed、
  summary.status=completed（不是 skipped）、metrics_written=4。两个客户都在，没有 failed。
  上一轮 2026-10-04 16:16 UTC（W41）同样 completed / metrics_written=4。
- ② flywheel_metrics 里 metric_key like 'seo.domain.%' 且 source='semrush' 共 18 行，
  最早 2026-09-27 16:16 UTC（= 验收日那次首跑），最新 2026-10-11 16:15 UTC。付费快照真的在写库。
- ③ flywheel_outcomes 里 metric_key like 'seo.domain.%' 共 20 行，分组后只有一组：
  verdict=inconclusive、confidence=0、覆盖 2 个客户，最早 2026-10-04 18:02 UTC、最新 2026-10-11 18:07 UTC。
  没有任何一行是别的结论 —— 第 1a 条的兜底生效。
  （10-09 夜巡当时这里是 0 行判不了；现在有了第二个快照点，outcome 开始产出，所以今晚能判了。）

来源/命令：Supabase 只读 SQL（生产项目 glbdnayojixmexgofbsd，经 clients 表核对 CTS/Oztop 两个 id 确认是生产库）：
- select ... from cron_run_logs where job_name='flywheel-seo-weekly' order by started_at desc limit 4
- select count(*), min/max(created_at) from flywheel_metrics where metric_key like 'seo.domain.%' and source='semrush'
- select verdict, confidence, count(*), count(distinct client_id) from flywheel_outcomes where metric_key like 'seo.domain.%' group by 1,2

结论：成。①②③ 三项今晚全部取到并全部达标。
