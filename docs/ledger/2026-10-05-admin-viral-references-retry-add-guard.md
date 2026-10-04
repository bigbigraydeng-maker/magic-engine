---
id: 2026-10-05-admin-viral-references-retry-add-guard
title: viral-references/[id]/retry 无 admin 检查
status: decided
owner: agent
decided_on: 2026-10-05
source: session:07fc4e50
verify_how: 改完后未登录请求返回 401、非本客户返回 403，单测覆盖，本地起开发服务试一次（不碰生产）
---
路径 src/app/api/admin/viral-references/[id]/retry/route.ts（POST）。重新触发 Gemini 分析（花钱）并更新记录。
修法：guardGlobalAdmin。
