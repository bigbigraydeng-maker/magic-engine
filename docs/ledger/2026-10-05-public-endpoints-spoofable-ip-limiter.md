---
id: 2026-10-05-public-endpoints-spoofable-ip-limiter
title: 多个公开接口的限流依赖可伪造的 X-Forwarded-For，限流可被绕过
status: decided
owner: agent
decided_on: 2026-10-05
source: session:07fc4e50
verify_how: 改完后写单测证明坏请求被拒，并在本地起开发服务手动试一次（不碰生产）
---
涉及 scan/run、public-scan/start、discover/register、clients/[id]/leads、auth/self-register。限流按 XFF 第一跳 IP，且部分在服务内存里（重启清零）或出错时放行。
动作：确认 Render/Cloudflare 是否剥掉客户端自带的 XFF；改用 Cloudflare 验证后的访客标识（tools-lab/visitor.ts 是现成做法）。
