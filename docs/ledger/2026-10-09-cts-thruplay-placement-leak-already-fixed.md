---
id: 2026-10-09-cts-thruplay-placement-leak-already-fixed
title: CTS 养池广告的「小游戏版位」漏钱早已堵住，不需要改在投广告
status: done
owner: agent
decided_on: 2026-10-09
source: session:5ca6dbb3
verify_by: 2026-10-23
verify_how: 按版位拆开查 CTS 养池广告组近 14 天花费，第三方应用版位那一行必须是 0；只要大于 0 就是又漏了，当天报 PM 并查活动记录看谁改过版位
done_on: 2026-10-09
done_ref: doc:docs/audits/2026-10-09-cts-instagram-connect-and-placement-leak.md
---
近 30 天那笔 88 元第三方版位花费全部发生在 9/12–9/16，是修复之前的历史账。
9/16 有人手动把第三方版位从清单里去掉，9/27 重新开投至今 12 天该版位花费连续为 0。
这同时第一次用真实花费验证了 9 月那个「设了但从没验证过」的修复确实有效。
另两个在投系列是自动版位但都是收留资广告，30 天第三方版位只花了 0.16 和 0 元，建议不动以免重置学习期。
规则留下：以后新建纯播放类广告组必须在建的时候就写死只投 Facebook 和 Instagram。
手工在 Ads Manager 建纯播放组必须当场回读版位（统筹 10-09 定：ME 自己起草的路径已有回读校验，不另开发新检查）。
