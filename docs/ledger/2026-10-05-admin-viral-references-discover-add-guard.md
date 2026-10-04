---
id: 2026-10-05-admin-viral-references-discover-add-guard
title: viral-references/discover 无 admin 检查，匿名者可烧 YouTube 配额与 Gemini 费用
status: decided
owner: agent
decided_on: 2026-10-05
source: session:07fc4e50
verify_how: 改完后未登录请求返回 401、非本客户返回 403，单测覆盖，本地起开发服务试一次（不碰生产）
---
路径 src/app/api/admin/viral-references/discover/route.ts（POST）。每次最多 30 个视频。
修法：guardGlobalAdmin。
