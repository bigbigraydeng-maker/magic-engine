---
id: 2026-10-05-content-route-abc-add-auth
title: 内容生成三个接口补上登录检查；其余缺检查的接口已排好队
status: decided
owner: agent
decided_on: 2026-10-05
source: session:07fc4e50
verify_how: 合并后未登录请求这三个接口返回 401 且无 AI 调用；其余按审计表优先级逐个开活
---
本次修了 content/route-a、route-b、route-c（PR #2247），并检查了客户归属。
其余缺登录检查的接口按风险排好队，在 docs/audits/2026-10-05-unauthenticated-api-routes.md 一张表里，最高优先级是 visual/video（花钱）。
