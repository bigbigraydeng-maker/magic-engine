---
id: 2026-10-26-war-map-source-state-split
title: 作战地图「数据过期」黄灯拆成「源头没花钱」vs「取数链路挂了」vs「读不到」
status: done
owner: agent
decided_on: 2026-10-26
source: session:0f14e562
verify_by: 2026-10-28
verify_how: 到 /dashboard/clients/c0000000-0000-0000-0000-000000000000/ads-health 看作战地图卡头部：旧主账户已 16 天没新花费 → 应显示「这几个账户 N 天内没花费：主账户（N 天）」；若 cron_run_logs 读不到就应显示「取数状态读不到」。截图比对，不再出现旧版「数据已 X 天没更新」文案。
done_on: 2026-10-26
done_ref: pr:3186
---
war-map 读 cron_run_logs 判链路（最近 48h 内对本客户是否 upsert 走通），结合 ad_daily_insights 的 staleDays 判上游。三态分开写：no_spend_upstream 列出账户名；fetch_chain_down 带失败次数 + 「查运行记录」链接到 /dashboard/admin/cron-health；unknown 只说读不到。不改 cron、不改 schema，B 级。
