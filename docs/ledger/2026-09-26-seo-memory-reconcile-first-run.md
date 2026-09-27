---
id: 2026-09-26-seo-memory-reconcile-first-run
title: 旧经验下架（第 1b 条）上线后第一次自动运行当天核对：真跑成功、关掉的条数和原因对得上、AI 可见度与社媒一条没动
status: done
owner: agent
decided_on: 2026-09-26
source: pr:2052
done_on: 2026-09-26
done_ref: pr:2052
verify_by: 2026-09-27
verify_how: 合并部署后第一次 memory-extractor（每天 06:30 UTC）跑完，查 cron_run_logs 里 job_name=memory-extractor 最近一条：①status=completed、failed 为 0；②summary.deactivated 的条数与 deactivated_by_reason 一致，SEO 约 200、广告 8（2026-09-26 生产只读估算：SEO 有效 112 / 失败 89 / 偏好 4、广告有效 5 / 失败 3，允许因当天新数据小幅偏差），原因只出现 no_execution_evidence / site_level_metric / source_missing / preference_no_support 这几类；③client_proven_patterns 与 client_failed_experiments 里 AI 可见度（geo / ai_visibility）与社媒的在用行数与运行前相同。三项全对算成
last_checked: 2026-09-27
check_note: 判不了：PR 9-26 13:10 UTC 才合并，合并后第一次旧经验下架要 9-27 06:30 UTC 才跑
---
PM 2026-09-26 定的硬规矩：以后才自动跑的功能，交付前要当场试跑，跑不全的部分开卡、验收日 = 第一次自动运行当天。

本卡对应 PR #2052 的「当场试跑」段：已在本机用真实的定时任务入口和新代码，对三个小客户的生产只读拷贝（131 条动作 / 96 条结论 / 23 条有效经验 / 19 条失败经验 / 6 条偏好）跑通一整轮——返回 200、0 错误、关 20 条（有效经验 19 条没执行的建议、偏好 1 条），AI 可见度 23 条一条没动。
当场跑不了的两块：CTS、Oztop 两个大客户的数据没拷；往正式库真写（按 id 分批关开关）要到第一次自动运行才发生。所以第一次自动运行当天按上面三条核对。
