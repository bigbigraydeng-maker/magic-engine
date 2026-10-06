# 日历巡检证据 2026-10-07（取数时间 2026-10-07 04:00–05:00 新西兰时间，全部只读）

数据库只读查询（Supabase 项目 glbdnayojixmexgofbsd，execute_sql，仅 SELECT）；Gmail 只读搜索；gh 只读。

## 1. 每周 SEO 快照第一次拍成没有（事件 9/28）
- cron_run_logs job=flywheel-seo-weekly：9/27 16:16Z 与 10/4 16:16Z 两周，CTS、Oztop 两个客户 summary.status=completed，metrics_written=4，error 为空。
- flywheel_metrics source=semrush 自 9/27 16:00Z 起：CTS 6 行、Oztop 6 行（两周各 3 行）。
- flywheel_outcomes metric_key like seo.domain.% 自 9/27 16:00Z 起：只有 inconclusive 11 行，最大 confidence=0。
- 结论：三项都成立。

## 2. 线索别重复打邮件名单的闸在生产上（事件 9/26）
- PR 1973 已于 9/24 合并。
- cron_run_logs job=meta-leads-sync，CTS 最近 12 轮（10/6 当天）：有 mailchimp 摘要的 4 轮里 skipped:already_synced 为 15–17、leadsIngested 17–18、settledLookupFailures 全为 0。
- 近 14 天 newContacts 每日合计 0–3（9/24=3，10/3=3，10/4=3，10/1、10/2、10/6=0），口径没有塌成 0。
- 附带事实：meta-leads-sync 近 14 天每一轮 status 都是 failed（样本 160 余轮），本事件没要求查这个，另行关注。
- 结论：三项都成立。

## 3. NAL 主力留言广告恢复花钱（事件 9/26）
- ad_daily_insights（level=ad，名称“物流_潜在客户_Message_8月”，币种 NZD 见 ad_entity_snapshots）：9/25 花费 10.16，9/26 花费 22.53（>0）。
- 附带事实：9/28 起花费几乎为 0（9/28 0.52），ad_entity_snapshots 10/6 12:31Z 状态 CAMPAIGN_PAUSED，当前整条广告系列处于暂停。
- 结论：事件要的“9/25 晚–9/26 早恢复花钱”成立；当前已暂停属后续动作，不在本事件范围。

## 4. 台账夜巡 9/27 有没有照常跑（事件 9/28）
- scheduled-tasks list_task_runs ledger-nightly-verify：2026-09-27T08:32Z 起一次，status=succeeded。
- 该卡（nal-messenger-15s-creative-3day-review）status 仍为 decided，夜巡只核 done 卡，所以卡头没有 last_checked 属正常。
- 结论：夜巡 9/27 正常跑过。

## 5. Google Workspace 续费（事件 9/25 与 10/2 截止）
- Gmail 只读：hello@magicengine.cloud 在 10/5 19:01Z 与 10/4 19:01Z 仍正常发出“今日待办”邮件，10/2 截止日之后邮箱未停用。
- 无法读到付款状态本身。结论：邮箱在截止日后仍可用。

## 6. Jason 对 Riverside 新版有没有回复（事件 9/28）
- Gmail 搜 “Riverside website update”：线程最后一封是 9/20 我方发出；9/20 之后 Jason 没有回复。
- 事件原文：没回不用催。结论：没回，无需动作。

## 7. CTS 留资目标当前值（事件 9/28）——没达预期
- goals 表 CTS 留资先导目标：primary_metric_key=leads_count，target_value=180，baseline=0，current_value=1，current_value_fetched_at=2026-10-05T17:31Z，source=auto.cron。
- 目标自带说明写“9 月 24 天 162 条 ≈ 6.8 条/天”；事件期望值“接近 9/24 以来广告留资合计”（9/24=13、9/25=10 起逐日累加，应在上百量级）。当前值 1 相差两个数量级。
- goal-current-value-refresh 最近 3 次运行均 completed、errors 为空，报表只对另一个成交目标给了 no_data；也就是说任务跑成了，但写进去的数字明显偏低，且没有任何告警。
- 结论：数字不对，需要查口径（取的是不是只算了某一天或某一路渠道）。
