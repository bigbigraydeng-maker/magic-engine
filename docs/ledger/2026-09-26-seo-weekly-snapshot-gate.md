---
id: 2026-09-26-seo-weekly-snapshot-gate
title: 每周 SEO 快照只把自己付费拍的那几行算「这周拍过」，不再被每天的谷歌数据骗成跳过（第 5 条）
status: verified
owner: agent
decided_on: 2026-09-26
source: pr:2057
done_on: 2026-09-26
done_ref: pr:2057
verify_by: 2026-09-28
verify_how: 2026-09-28 新西兰 05:15（= 09-27 16:15 UTC）第一次自动运行后查三件事：①cron_run_logs 里 job_name=flywheel-seo-weekly 那一轮的单客户记录，CTS 与 Oztop 都是 status=completed 且 summary.status 为 completed（不是 skipped），metrics_written > 0；②flywheel_metrics 里这两个客户在那之后出现 source='semrush' 的 seo.domain.* 行；③flywheel_outcomes 里之后算出的 seo.domain.* 结论全是 inconclusive、confidence 0（第 1a 条兜住）。三项全对算成；①里出现 failed 时，那条运行记录的 error 就是原因
last_checked: 2026-10-14
check_note: 今晚三项全部重取并全部达标：W42（10-11 16:15 UTC）CTS 与 Oztop 都是 completed 而非 skipped、各 metrics_written=4；flywheel_metrics 里 semrush 的 seo.domain.* 共 18 行（9-27 首跑到 10-11）；flywheel_outcomes 里 seo.domain.* 20 行全是 inconclusive/confidence 0（10-09 当时 0 行判不了，现在有第二个快照点就产出了）
verified_ref: doc:docs/ledger/evidence/2026-09-26-seo-weekly-snapshot-gate--2026-10-14.md
---
PM 2026-09-26 回「全开工」（第 5 条，B 级，排在第 1a 条上线之后）。第 1a 条 #2044 已于 2026-09-26 03:10 UTC 部署。
根因：防重复扣费闸只看「最近 156 小时有没有 flywheel='seo' 的行」，每天的 GSC / GA4 回拉也写这类行，于是 W37–W39 三周两个客户全部 skipped、从没拍成过一次付费快照。
已当场试跑（本机、替身数据服务、不花钱）：生产形状的数据下两个客户都会真拍；这周已有付费快照时两个都跳过。付费查询与真实写库要到第一次自动运行才发生，所以验收日 = 第一次自动运行当天。
花费：每周 2 个客户 × 2 次 Keyword Intelligence 付费查询（PM 2026-09-07 已拍板开这条）。
