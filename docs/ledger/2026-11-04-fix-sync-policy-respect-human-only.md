---
id: 2026-11-04-fix-sync-policy-respect-human-only
title: 广告自动化同步不再把「只能人点头」的暂停建议写成全自动；被拦下的暂停建议进今日待办
status: decided
owner: agent
decided_on: 2026-11-04
source: doc:docs/ledger/evidence/2026-11-04-ads-auto-pause-policy-check.md
verify_by: 2026-11-12
verify_how: 合并部署后等下一次每日对账跑完，只读查 CTS 和 NAL 两家 ads.auto_pause_on_d3 当前生效规则的 mode 都是 require_approval、ads_autonomy_sync_receipts 有一行 to_mode=require_approval 的回执；再在测试库构造一条近 7 天 payload.status=blocked 的 D3 账，今日待办「需要你动手」里出现一条带广告组名、原因、链接的待办。两项都对才算成，任何一家还是 auto_approve 算不成
---
风险级别 A（碰执行内核授权）。同步规则改成从动作定义读「只能人点头」，与内核拒绝判据同一条；今日待办新增「暂停建议被拦下」一类（近 7 天、同一广告组只出一条）。不改现有数据、不改演练开关、不碰 Meta。
