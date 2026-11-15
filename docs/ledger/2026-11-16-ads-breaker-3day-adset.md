---
id: 2026-11-16-ads-breaker-3day-adset
title: 广告熔断改成按广告组看最近三个完整日
status: decided
owner: agent
decided_on: 2026-11-16
source: doc:docs/ledger/2026-11-09-ads-circuit-breaker-propose-pause.md
verify_by: 2026-11-17
verify_how: 相关测试要过：三个完整日超过目标两倍才出暂停广告组确认卡；只有一天差且三天合计没超不出；没有线索但花费超过也出；没有目标不出；同一广告组同一天不重复；过期账户只压自己的卡。
---
单日按广告系列比成本的暂停卡不再出。
三个完整日按新西兰日历，用库里已有的每日花费，不新拉广告平台。
超过目标两倍才出已有的「暂停这个广告组」确认卡。点确认前会再读一遍，条件不在就不动。
花费上限和政策问题仍按广告系列出卡。
