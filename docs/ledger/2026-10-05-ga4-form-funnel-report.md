---
id: 2026-10-05-ga4-form-funnel-report
title: 只读"表单漏斗"报告：开始填表的人 vs 到过感谢页的人（粗估放弃率，注明是代理估算）
status: decided
owner: agent
decided_on: 2026-10-05
source: session:cdd5dbf9
verify_by: 2026-10-08
verify_how: 合并后用手动试跑入口跑 `job=ga4-form-funnel`，摘要里有 CTS 的 form_start 人数、感谢页人数、代理放弃率与说明；非 CTS 或没连谷歌分析的客户显示 no_ga4_connection
---
PM 2026-10-05 问"有多少人点了表单但没填"。线上谷歌分析凭证只在服务器上，所以做成只读路由由手动试跑入口触发。不写库、不改网站。改 .github/ 属 A 级。
