---
id: 2026-10-18-cts-youtube-api-publish-staging
title: YouTube 官方接口上传模块已写好；要等有 CTS 频道权限的人授权，才能做第一次不公开试传
status: done
owner: agent
decided_on: 2026-10-18
source: session:2047e9f3
verify_by: 2026-10-25
verify_how: 有频道权限的人授权后，用不公开试片传一次；读回来的频道、可见范围、封面都对才算成；公开发布仍须当次直接授权
done_on: 2026-10-18
done_ref: pr:2770
---
代码在 src/lib/youtube-publish/（频道锁定、私享/不公开上传、封面、读回；公开发布没做），授权入口 /api/auth/google/youtube/start。
2026-10-18 已完成：数据库放宽、Google 后台加回调地址、用 CTS 频道账号授权成功（库里已有一条 active 连接，两项权限齐）。
还没做：第一次私享试传 + 读回验收。验收通过前不公开发布任何视频。
