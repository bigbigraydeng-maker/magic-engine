---
id: 2026-09-26-ads-digest-pick-ads-measurable-goal
title: 客户同时有多个进行中目标时，广告日报的目标进度改成优先看广告能量到的那个（留资/私信开聊），不再因为最新的是报名目标就一直空着
status: verified
owner: agent
decided_on: 2026-09-26
source: session:803d3b06
verify_by: 2026-09-29
verify_how: 合并上线后第一份 CTS 广告日报的目标进度段显示的是留资目标（有数字或带原因的未判），而不是「没有生效中的目标」或报名目标
done_on: 2026-09-26
done_ref: pr:2056
last_checked: 2026-10-14
check_note: ads_growth_states 里 CTS 全部 19 天（9-24 到 10-13）的 payload.goal.label 都是「留资数」，含上线后第一条 9-26（actualToDate 29）和最近三天（18/18/19，target 180、verdict behind）；同期库里 CTS 最新建的目标是自然搜索点击（非广告能量指标），正是这张卡要修的场景，结果没有一天退回报名目标或空目标
verified_ref: doc:docs/ledger/evidence/2026-09-26-ads-digest-pick-ads-measurable-goal--2026-10-14.md
---
根因：日报取目标只拿最新一个进行中目标；CTS 最新的是报名目标（读成交记录，常为未判），广告能量的留资目标被跳过。
修法按指标种类挑，不按客户挑；都不是广告指标时仍取最新。
