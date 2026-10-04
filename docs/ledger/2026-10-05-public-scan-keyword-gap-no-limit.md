---
id: 2026-10-05-public-scan-keyword-gap-no-limit
title: public-scan/keyword-gap 匿名可调且没有任何限流，调用 DataForSEO 花钱
status: decided
owner: agent
decided_on: 2026-10-05
source: session:07fc4e50
verify_how: 改完后写单测证明坏请求被拒，并在本地起开发服务手动试一次（不碰生产）
---
路径 src/app/api/public-scan/keyword-gap/route.ts（GET/POST）。域名和条数（最大 500）由调用者定，没有缓存/限流/人机验证。
修法：参考 public/site-check 的 Cloudflare 访客键 + 日/月全站上限做法。
