---
id: 2026-11-28-official-site-gsc-not-indexed-redirects
title: 官网旧 .com.au 地址 404 改成跳对应新页、http 统一跳 https，等 Jundong 换服务器配置后验
status: decided
owner: pm
decided_on: 2026-11-28
source: session:e5945d2a
verify_by: 2026-12-05
verify_how: 线上 curl 八个地址（/about /ai-search /geo /real-estate /demo/ /cn/terms /cn/about，以及 http 开头的 /en/）都应返回 301 到改动单里写的新页；八个全对再到 GSC 两个资源的「404」「已抓取未收录」「备用网页有适当规范」点验证修复；Jundong 还没换配置就记「未上线」不算不成
---
GSC 2026-11-28 未收录清单与逐个处理方式在官网仓库 magic-engine-dev/magic-engine-jundong-collab 改动单 36（只改 deploy/nginx.conf）。
.com.au 全站由 Cloudflare 带路径跳到 .co.nz，修复只在 .co.nz 的服务器配置。app./portal. 后台登录页的屏蔽/不收录是有意的，不处理。
上线要 Jundong 在 AWS 换 nginx.conf 并先跑 nginx -t（本机没真 nginx 验过语法）。
