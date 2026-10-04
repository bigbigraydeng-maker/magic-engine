---
id: 2026-10-05-visual-video-add-auth
title: 视频生成接口 visual/video 没有登录检查，匿名者可烧视频生成费
status: decided
owner: agent
decided_on: 2026-10-05
source: session:07fc4e50
verify_how: 改完后未登录请求返回 401、非本客户返回 403，单测覆盖，本地起开发服务试一次（不碰生产）
---
路径 src/app/api/visual/video/route.ts（POST）。严重：花钱（Seedance 出视频）+ 给任意客户写 visual_assets / production_items。调用方：后台 visuals 页、execution 页（登录用户）。
修法：同 content/route-a 的做法，加 requirePaidClientAccess + 校验 post_id 属于该客户。优先级按 §11 为最高档，建议下一个修。
