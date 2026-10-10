---
id: 2026-10-06-ads-other-active-writers-no-pm-gate
title: 还有几处能把广告开成「投放中」却没有 PM 授权和回执：每日自动推广同步、止损恢复、TikTok、Google
status: decided
owner: agent
decided_on: 2026-10-06
source: session:a0f2e1de
verify_by: 2026-10-13
verify_how: 逐项决定：每日自动推广同步新建广告的默认状态是否锁死为暂停（现在配置表允许改成投放中）；TikTok/Google 的重开是否同样限定 PM；Kernel 内恢复类动作保持现状
---
卫青、狄仁杰两审都标出：winner-reel-sync 每日任务按配置表 new_ad_default_status 建广告，设成 ACTIVE 就会无人批准地花钱。
TikTok / Google 的重开入口仍是「付费客户账号即可」。本 PR 只管 Meta 的两个入口，这些另开活。
