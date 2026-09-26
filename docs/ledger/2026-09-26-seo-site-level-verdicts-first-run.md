---
id: 2026-09-26-seo-site-level-verdicts-first-run
title: 「SEO 效果不再拿整站涨跌来判」（第 1a 条）上线后第一次自动归因当天核对：真跑成功、整站 SEO 结论全改成「判不了」
status: done
owner: agent
decided_on: 2026-09-26
source: pr:2044
done_on: 2026-09-26
done_ref: pr:2044
verify_by: 2026-09-27
verify_how: 2026-09-26 06:00 UTC 起的第一轮归因（attribution-cron，每 6 小时）跑完后查两件事：①cron_run_logs 里 attribution-cron 最近一条 status=completed，summary.gsc.errors 为空或只有零星几条且 outcomes_written > 0；②flywheel_outcomes 里 computed_at 晚于 2026-09-26T04:00:00Z 的整站 SEO 行（metric_key 为 seo.gsc.clicks / seo.gsc.impressions / seo.gsc.avg_position，或以 seo.domain. / seo.ga4. 开头）全部 verdict=inconclusive、confidence=0。两项全对算成
---
PM 2026-09-26 定的硬规矩：以后才自动跑的功能，交付前要当场试跑；跑不了的开卡，验收日 = 第一次自动运行当天。
#2044 在 2026-09-26 03:05 UTC 合并、03:10 UTC 部署。当时本窗口还不知道这条规矩（它 02:38 UTC 才定），没有当场试跑；归因任务要拿第三方数据、只能等定时触发，所以补开本卡，按第一次自动运行核对。PM 日历另有 9/27 09:00 的同内容提醒。
