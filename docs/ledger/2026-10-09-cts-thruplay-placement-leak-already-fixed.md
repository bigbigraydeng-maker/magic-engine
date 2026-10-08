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
CTS 养池广告的「小游戏版位」漏钱经核查已是历史账，当前版位花费为 0，不需要改在投广告。
花费明细、日期和各系列情况见审计文档（done_ref），台账不重复记录。
规则留下：新建纯播放类广告组必须建的时候就写死只投 Facebook 和 Instagram；手工在 Ads Manager 建的必须当场回读版位（ME 自己起草的路径已有回读校验，不另开发新检查）。
