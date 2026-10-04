---
id: 2026-10-05-transcript-route-remove-dead
title: transcript 接口无登录检查（调 Supadata 付费转录）且全仓没人调用，建议删除
status: decided
owner: agent
decided_on: 2026-10-05
source: session:07fc4e50
verify_how: 确认无外部调用方后路由已删除，全仓搜不到该路径
---
路径 src/app/api/transcript/route.ts（POST）。花钱、无鉴权、无调用方。
建议：确认无外部调用后删除。
