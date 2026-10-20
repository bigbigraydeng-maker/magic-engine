---
id: 2026-10-20-war-map-actual-launch-per-account
title: 作战地图：实际开投日、按绑定账户分池、数据停更不再绿灯
status: done
owner: agent
decided_on: 2026-10-20
source: pr:2935
verify_by: 2026-10-22
verify_how: 打开 CTS 广告健康页的作战地图：倒计时应显示「已开投（实际 10/20）」+「计划记录待更新」；观众池总览如数据仍停更应写「数据已 N 天没更新」；欠款个人户标不可用且不计入。不对就查最新一轮广告组快照有没有带上新系列。
done_on: 2026-10-20
done_ref: pr:2935
---
纯显示修复，不改投放、不写库、不改计划数据。截图在 docs/ledger/evidence/war-map-fix/（「已开投」那格是模拟数据，真数据要等下一轮快照带上新系列才亮）。
账户清单以绑定表为准；绑了但没快照的账户显示「已绑定，暂无数据」。
