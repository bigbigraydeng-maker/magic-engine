---
id: 2026-10-18-cts-youtube-api-publish-staging
title: YouTube 官方接口上传模块已写好；要等有 CTS 频道权限的人授权，才能做第一次不公开试传
status: decided
owner: pm
decided_on: 2026-10-18
source: session:2047e9f3
verify_by: 2026-10-25
verify_how: 有频道权限的人授权后，用不公开试片传一次；读回来的频道、可见范围、封面都对才算成；公开发布仍须当次直接授权
---
方案文档：Dropbox 外的本地 outputs/cts-youtube-api-publishing-20261018。代码在 src/lib/youtube-publish/（只做频道锁定、私享/不公开上传、封面、读回；公开发布没做）。
阻碍：当前登录账号管不了目标频道；还没有连接 YouTube 的授权入口和 Google 云项目配置。
