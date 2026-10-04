---
id: 2026-10-05-baselines-domains-collect-add-guard
title: baselines/domains/[id]/collect 无登录检查，匿名者可触发 Semrush 采集（花钱）
status: decided
owner: agent
decided_on: 2026-10-05
source: session:07fc4e50
verify_how: 改完后未登录请求返回 401、非本客户返回 403，单测覆盖，本地起开发服务试一次（不碰生产）
---
路径 src/app/api/baselines/domains/[id]/collect/route.ts（POST）。行业基线属平台级数据。
修法：guardGlobalAdmin。调用方为后台 industry-baselines 页（该路径由推断，需确认）。
