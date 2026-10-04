---
id: 2026-10-05-baselines-domains-id-add-guard
title: baselines/domains/[id] 的修改/删除无登录检查，且 PATCH 把请求体原样写库
status: decided
owner: agent
decided_on: 2026-10-05
source: session:07fc4e50
verify_how: 改完后未登录请求返回 401、非本客户返回 403，单测覆盖，本地起开发服务试一次（不碰生产）
---
路径 src/app/api/baselines/domains/[id]/route.ts（PATCH/DELETE）。除缺鉴权外还有「整包请求体直接 update」的字段注入问题。
修法：guardGlobalAdmin + 字段白名单。
