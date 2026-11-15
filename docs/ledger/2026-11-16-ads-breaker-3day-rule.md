---
id: 2026-11-16-ads-breaker-3day-rule
title: 广告组三个完整日的成本规则先单独写好
status: decided
owner: agent
decided_on: 2026-11-16
source: doc:docs/ledger/2026-11-09-ads-circuit-breaker-propose-pause.md
verify_by: 2026-11-17
verify_how: 纯函数测试要过：三个完整日超过目标两倍才判；只有一天差且三天合计没超不判；没有线索但花费超过也判；没有目标不判。这一步还不发出暂停卡，原来的单日广告系列规则仍在。
---
三个完整日按新西兰今天之前的三天相加，缺的天当 0。
超过约定目标的倍数才判这个广告组。没有目标就跳过。
这一步只是判定，不读广告平台，也不出确认卡。
原来按广告系列看单日的规则先留着，下一张再换成这条。
