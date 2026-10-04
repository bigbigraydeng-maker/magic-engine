---
id: 2026-10-05-publer-published-webhook-unsigned
title: Publer 发布回调 webhooks/publer-published 没有任何来源校验
status: decided
owner: agent
decided_on: 2026-10-05
source: session:07fc4e50
verify_how: 改完后写单测证明坏请求被拒，并在本地起开发服务手动试一次（不碰生产）
---
路径 src/app/api/webhooks/publer-published/route.ts（POST）。知道一个 publer_post_id 的人可以把帖子标成已发布并写飞轮结果，污染发布回执。
动作：确认 Publer 是否提供回调签名/密钥；没有的话加共享密钥路径参数或回查 Publer 接口核对。
