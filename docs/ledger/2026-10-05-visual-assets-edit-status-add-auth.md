---
id: 2026-10-05-visual-assets-edit-status-add-auth
title: visual-assets/[assetId]/edit-status 无登录检查，任何人可改素材的终稿/编辑状态
status: decided
owner: agent
decided_on: 2026-10-05
source: session:07fc4e50
verify_how: 改完后未登录请求返回 401、非本客户返回 403，单测覆盖，本地起开发服务试一次（不碰生产）
---
路径 src/app/api/visual-assets/[assetId]/edit-status/route.ts（PATCH）。
修法：按素材所属 client_id 做 requirePaidClientAccess。
