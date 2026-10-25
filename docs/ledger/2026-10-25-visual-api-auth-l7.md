---
id: 2026-10-25-visual-api-auth-l7
title: L7：/api/visual/* 必须登录并校验客户归属，别家资源一律拒绝
status: done
owner: agent
decided_on: 2026-10-25
done_on: 2026-10-25
done_ref: pr:3123
source: issue:3090
verify_by: 2026-11-01
verify_how: 合并后抽查未登录请求 video/avatar/upload/batch-image/status 均返回 401 且没有付费生成调用
---
范围：video、avatar、upload、status、queue、assets、batch-image 七个路由，在付费调用和写存储之前先登录、再校验客户归属。
batch-image 遇别家客户的 post 整批 404；status 别家资产 404；测试见 src/app/api/visual/__tests__/auth-guard.test.ts。
不加扣费、不改数据库结构。
