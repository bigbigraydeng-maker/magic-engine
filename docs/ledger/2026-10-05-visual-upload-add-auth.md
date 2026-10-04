---
id: 2026-10-05-visual-upload-add-auth
title: visual/upload 无登录检查，可向公开存储桶上传最大 500MB 并改写桶配置
status: decided
owner: agent
decided_on: 2026-10-05
source: session:07fc4e50
verify_how: 改完后未登录请求返回 401、非本客户返回 403，单测覆盖，本地起开发服务试一次（不碰生产）
---
路径 src/app/api/visual/upload/route.ts（POST）。写入 visual-assets 桶（调用者自选 client_id/post_id 路径）+ visual_assets；ensureBucket 还会把桶设成公开且无大小限制。
修法：requirePaidClientAccess + 归属校验，并收紧 ensureBucket 行为。
