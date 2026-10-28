---
id: 2026-10-28-ad-hourly-insights-record
title: 广告每个小时的数据开始留存：新增逐小时记录表，随每天的 Meta 取数一起存
status: done
owner: agent
decided_on: 2026-10-28
source: session:90a50c3b
verify_by: 2026-11-02
verify_how: PM 回「go apply」建表并合并部署后，第一次每天自动取数（17:00 UTC）跑完，在 ad_hourly_insights 里能查到昨天每个在投广告组的逐小时行（每组最多 24 行），且某个广告组某天的逐小时花费合计与 ad_daily_insights 同一天基本一致（差几分钱可接受）；cron_run_logs 里 google-data-pullback-daily 的 errors 不含 adset_hourly。任何一项不成就查运行记录里 adset_hourly 的报错。
done_on: 2026-10-28
done_ref: pr:3352
---
IMPACT「Check」要回看哪几个小时花钱、出线索。原来只有按天的数据，没有逐小时留存；每小时盯盘只出提醒，不存数字。
新表 ad_hourly_insights（广告组 × 日期 × 小时），由每天已在跑的 Meta 取数任务多拉昨天的 24 小时存进去；不新增定时任务。本卡只管记录，不含页面或诊断读取（后续事项）。
