---
id: 2026-10-18-cts-youtube-reauthorize-force-ssl
title: YouTube 授权要多要一项「改视频可见范围」权限；上线后 CTS 频道账号要重新点一次授权
status: decided
owner: pm
decided_on: 2026-10-18
source: session:a59e4edc
verify_how: 改动上线后，用 CTS 频道的品牌账号在设置页重新点「连接 YouTube 频道」，授权页要看到三项权限；完成后库里该连接的权限清单含 youtube.force-ssl。这一步不会公开任何视频
---
Google 官方文档确认：改视频可见范围只认 youtube、youtube.force-ssl、youtubepartner 三者之一，我们选最窄的 force-ssl。
旧授权不会自己断线（Google 刷新令牌时不重放权限清单），只是还不能真发；重新授权前现状不变。
