---
id: 2026-10-05-voice-admin-guard-lets-scoped-admins-in
title: 语音租户管理接口用的 requireVoiceAdmin 比全局管理员检查更松，受限管理员能改任意租户
status: decided
owner: agent
decided_on: 2026-10-05
source: session:07fc4e50
verify_how: 改完后写单测证明坏请求被拒，并在本地起开发服务手动试一次（不碰生产）
---
路径 src/app/api/voice/tenants/**（GET/POST/PATCH/DELETE 多个）。requireVoiceAdmin 只判 role===admin，DEMO_ADMINS（只该看一个客户的演示账号）也能通过，可改任意租户的语音配置，agents 会驱动 OpenAI 实时语音费用。
修法：改用 guardGlobalAdmin 判据；GET 读取路径也要确认租户存在。
