---
id: 2026-11-22-ads-automation-switches
title: 客户设置页可以开关三项广告自动化
status: done
owner: agent
decided_on: 2026-11-22
source: doc:docs/STATE.md
verify_by: 2026-11-25
verify_how: 合并后用内部管理员打开任一客户的设置页「广告健康监测」，三个开关显示当前状态且默认关；拨动一个后另两个和 leads_config 里其它字段不变，工作日志多一行中文记录。客户门户账号打开同一页看不到这三个开关。
done_on: 2026-11-22
done_ref: pr:3910
---
开关键：日内预警、日趋势检查（true 或 enabled）、调优确认卡（只预留布尔键）。只许内部管理员改。不改广告、不加表。
