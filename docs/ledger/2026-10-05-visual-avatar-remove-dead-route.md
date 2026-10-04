---
id: 2026-10-05-visual-avatar-remove-dead-route
title: 数字人接口 visual/avatar 无登录检查且全仓没人调用，建议直接删除
status: decided
owner: agent
decided_on: 2026-10-05
source: session:07fc4e50
verify_how: 确认无外部调用方后路由已删除，全仓搜不到该路径
---
路径 src/app/api/visual/avatar/route.ts（POST）。花钱（HeyGen）、无鉴权、grep 全仓无调用方。
建议：确认无外部调用后删除该路由，比加鉴权更干净。
