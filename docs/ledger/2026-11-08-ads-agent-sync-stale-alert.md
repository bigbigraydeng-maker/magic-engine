---
id: 2026-11-08-ads-agent-sync-stale-alert
title: 广告 Agent 定时同步太久没成功 + 花费超日上限只读提醒进今日待办
status: done
owner: agent
decided_on: 2026-11-08
source: pr:claude/ads-heartbeat-stale-alert
risk: B
verify_by: 首次 pm-daily-todo 自动运行当天（7 天内）
verify_how: 合并后等次日今日待办邮件：有 Meta 广告的客户若某路同步超过容错仍无成功，应出现中文说明（无表名/无 JSON）；花费严格高于日上限时出现只读提醒且不写熔断。
---

按客户读 `ad_daily_insights` / `ad_entity_snapshots` / 线索同步与方案复查运行记录的新鲜度；纯函数判据在 `src/lib/ads-strategy/monitoring/`；出口复用 `pm-todo`（`ads_agent_sync_stale` / `ads_daily_spend_over_cap_notice`），不新表、不改广告。
