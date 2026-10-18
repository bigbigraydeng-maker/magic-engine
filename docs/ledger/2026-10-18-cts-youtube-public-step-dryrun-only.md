---
id: 2026-10-18-cts-youtube-public-step-dryrun-only
title: YouTube「公开发布」那一步已写好但只能演练；真发前要补权限并重新授权
status: decided
owner: pm
decided_on: 2026-10-18
source: session:2047e9f3
verify_by: 2026-10-25
verify_how: 真发前必须同时具备：七项检查都有证据、本条视频当次直接授权、CTS 频道重新授权带「改视频可见范围」权限；缺任一项就不真发
---
代码在 src/lib/youtube-publish/publish.ts，默认只演练。当前保存的授权只有上传和读取，Google 会拒绝「改成公开」，所以现在真发必失败。
补权限属于改授权范围，要单独走审查，并让 CTS 频道账号再点一次授权。
