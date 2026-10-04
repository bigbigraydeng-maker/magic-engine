---
id: 2026-10-05-admin-viral-references-add-guard
title: admin/viral-references 列表与新增接口位于 /api/admin 却没有 guardAdmin
status: decided
owner: agent
decided_on: 2026-10-05
source: session:07fc4e50
verify_how: 改完后未登录请求返回 401、非本客户返回 403，单测覆盖，本地起开发服务试一次（不碰生产）
---
路径 src/app/api/admin/viral-references/route.ts（GET/POST）。POST 一次最多 30 条网址并触发 Gemini 分析（花钱）；表里含客户备注。
修法：guardGlobalAdmin（影响跨客户爆款库）。同族 4 个路由见相邻卡片。
