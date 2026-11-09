---
id: 2026-10-18-cts-ad-insights-blind-for-a-week
title: 已核实——CTS 不是采集坏了，是广告账户欠款停摆投不出去；我开卡时判的根因错了，P0 不成立，关卡
status: verified
owner: agent
decided_on: 2026-10-18
done_on: 2026-10-18
done_ref: doc:docs/specs/2026-10-18-wp32-hanxin-implementation-plan-v0.2.md
verified_ref: doc:docs/ledger/evidence/2026-10-18-cts-ad-insights-blind-for-a-week--2026-10-18.md
last_checked: 2026-10-18
check_note: 库里 account_status 在 10-10 由 1 翻成 3（欠款未结）并连续 8 天，正是最后一天有花费的那天；采集没坏
verify_how: 已验完，证据在 verified_ref。若要复核：查 ad_entity_snapshots 里 level='account' 的 account_status 逐日值，10-10 当天由 1 变 3 即为欠款停摆（account-status.ts 里 3 = UNSETTLED）；再比对 ad_daily_insights 最后一天花费也是 10-10。两者同一天就说明不是采集故障。
source: session:c668eb35
---
我开卡时判「数据看不见、可能取数断了」，错了。74 号用 Meta 接口核实是真零花费（欠款未结），我用库里 account_status 独立核过，对得上（证据文件里有逐日表）。
关键一点：这个事实库里每天都有、连续 8 天，却没有任何代码读它 —— 不是数据缺口，是信号没人消费。
这条缺口已由 74 号的 PR 2805（10-18 02:56 已合并）补上：账户状态异常超 24 小时进今日待办。所以本卡不留后续，指到那一刀，按 verified 关闭。
对 §11 的更正：原打 P0 的依据是「每天都在盲投」，根因换掉后不成立；不降级留尾，留着会变成没人认领的僵尸卡。
顺带：探针记的 spend_missing 含义是「账户没在投/结不了账」，不是取数管线坏了，看回执别读错。
