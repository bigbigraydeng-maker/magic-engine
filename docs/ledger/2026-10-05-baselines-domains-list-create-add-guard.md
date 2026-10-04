---
id: 2026-10-05-baselines-domains-list-create-add-guard
title: baselines/domains 的列表与新增无登录检查
status: decided
owner: agent
decided_on: 2026-10-05
source: session:07fc4e50
verify_how: 改完后未登录请求返回 401、非本客户返回 403，单测覆盖，本地起开发服务试一次（不碰生产）
---
路径 src/app/api/baselines/domains/route.ts（GET/POST）。平台级行业基线数据可被匿名读写。
修法：guardGlobalAdmin。
