---
id: 2026-10-05-admin-viral-references-analyze-pending-add-guard
title: viral-references/analyze-pending 无 admin 检查（只读计数，风险低）
status: decided
owner: agent
decided_on: 2026-10-05
source: session:07fc4e50
verify_how: 改完后未登录请求返回 401、非本客户返回 403，单测覆盖，本地起开发服务试一次（不碰生产）
---
路径 src/app/api/admin/viral-references/analyze-pending/route.ts（POST）。只读，不触发分析。
修法：guardGlobalAdmin，随同族路由一起改即可。
