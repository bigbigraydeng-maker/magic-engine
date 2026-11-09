---
id: 2026-11-10-ad-intraday-forecast-wire
title: 日内花费样本接上收盘预测，超过每天上限只提醒
status: decided
owner: agent
decided_on: 2026-11-10
source: doc:docs/ledger/2026-11-10-ad-intraday-forecast-wire.md
verify_by: 2026-11-13
verify_how: 采样那张卡的表套用、并且这一份进主干后，广告健康页能看到花费收盘预测；预测高于已批准计划的每天上限时，待办里出现超限提醒，广告本身不被改动。表还没套用就不算失败。
---
样本交给已有的收盘预测，显示在广告健康页。
预测高于已批准计划的每天上限时，走现有的超限提醒。
这条只是提醒。系统不暂停广告，也不改预算。
结果和链接点击仍显示数据不足，因为只读花费接口没有这两项的日内样本。
