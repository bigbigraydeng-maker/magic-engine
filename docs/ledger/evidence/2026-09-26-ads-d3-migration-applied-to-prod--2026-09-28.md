# 证据 · 2026-09-26-ads-d3-migration-applied-to-prod · 2026-09-28

fetched_at: 2026-09-28T09:20:00Z

查了什么：cron_run_logs job_name=google-data-pullback-daily（9-26 16:00 UTC 之后）；ad_health_narratives
insight_date=2026-09-26 的 email_status 与 payload

数字：
- google-data-pullback-daily 9-27、9-28 两次 17:00 UTC 都跑了，都不再报
  「column ad_strategy_configs.autopilot_enabled does not exist」——这条卡要修的那个错误确认消失
- ad_health_narratives insight_date=2026-09-26：3 个客户（含 CTS）email_status 全是 sent，不是 pending
- CTS 那条 narrative 的 payload.evaluated.diagnoses 里有 D11×2（再营销池断供）、D8、D5 三种广告级规则命中，
  adLevelCoverage 两个广告账号都 ran:true —— 广告级新规则（D2-D11 系列）确认在跑、确认命中

另外发现（跟这条卡无关的新问题，不在本卡验收范围内）：这两次 google-data-pullback-daily 的 cron_run_logs
status 都是 failed、failed_count=3，报错是「meta: getAdAccountInsights returned null — check
META_SYSTEM_USER_TOKEN and ad account ID」——3 个账号的 Meta 令牌/账号读取问题，跟 migration/autopilot_enabled
无关，是另一件事，未处理，仅记录在此供开发窗口知悉。

来源/命令：Supabase cron_run_logs + ad_health_narratives 表只读查询

结论：成。migration 补 apply 后：①原报错不再出现；②两个客户的每日广告巡察不再被跳过（narrative 正常生成、
正常发邮件）；③CTS 那条带广告级新规则命中。三项全满足。
