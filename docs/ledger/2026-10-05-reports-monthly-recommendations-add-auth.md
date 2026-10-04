---
id: 2026-10-05-reports-monthly-recommendations-add-auth
title: 月报建议接口无登录检查，匿名者可烧 GPT-4o 并读到别家客户月报衍生数据
status: decided
owner: agent
decided_on: 2026-10-05
source: session:07fc4e50
verify_how: 改完后未登录请求返回 401、非本客户返回 403，单测覆盖，本地起开发服务试一次（不碰生产）
---
路径 src/app/api/reports/[clientId]/monthly/recommendations/route.ts（POST）。花钱 + 泄露其它客户的报告内容。
调用方：后台月报页。修法：requirePaidClientAccess(clientId)。
