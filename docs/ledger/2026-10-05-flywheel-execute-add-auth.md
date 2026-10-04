---
id: 2026-10-05-flywheel-execute-add-auth
title: flywheel/execute 无登录检查，可为任意客户伪造飞轮动作记录
status: decided
owner: agent
decided_on: 2026-10-05
source: session:07fc4e50
verify_how: 改完后未登录请求返回 401、非本客户返回 403，单测覆盖，本地起开发服务试一次（不碰生产）
---
路径 src/app/api/flywheel/execute/route.ts（POST）。按 body 里的 clientId 派发到适配器，只写 flywheel_actions，不直接花钱，但会污染归因与审计数据。
调用方：后台 FlywheelDrawer。修法：requireDashboardClientAccess。
