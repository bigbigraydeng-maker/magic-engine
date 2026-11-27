---
id: 2026-11-16-ads-breaker-3day-wire
title: 三个完整日规则接到暂停广告组确认卡
status: done
owner: agent
decided_on: 2026-11-16
done_on: 2026-11-16
done_ref: pr:3874
source: doc:docs/ledger/2026-11-16-ads-breaker-3day-rule.md
verify_by: 2026-11-17
verify_how: 相关测试要过：按广告组出暂停确认卡；单日广告系列花费不再单独出成本卡；同一广告组同一天不重复；过期账户只压自己的卡；确认时条件不在就不暂停。
---
三个完整日按广告组出已有的暂停确认卡，不直接改广告。
旧的单日广告系列成本规则拿掉，不和这条一起跑。
花费超上限和政策问题仍按广告系列出暂停系列卡。
同一广告组同一天最多一张。过期账户只压自己的卡。
