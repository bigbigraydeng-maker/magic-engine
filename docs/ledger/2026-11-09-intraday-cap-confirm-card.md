---
id: 2026-11-09-intraday-cap-confirm-card
title: 收盘预测会超每天上限时，只出一张确认卡，不改广告
status: decided
owner: agent
decided_on: 2026-11-09
source: doc:docs/ledger/2026-11-10-ad-intraday-forecast-wire.md
verify_by: 2026-11-12
verify_how: 采样任务跑过一轮后，预测高于那一份已批准计划的每天上限时，确认卡里有一张降预算或已超限才暂停的建议；缺计划、缺上限、样本或快照过期时没有这张卡，待办里是原来的读不到提醒。同一客户同一个新西兰日没有第二张未关闭的卡。
---
预测会超过已批准计划的每天上限时，出确认卡建议把日预算降回去；人没点确认就不改。
已经花过上限才建议暂停。算不出能降下的金额时建议保持现状，不建议加预算。
缺数、过期、不止一份已批准计划，都不出卡，走原来的读不到提醒。
同一客户同一个新西兰日最多一张未关闭的卡。
指针：doc:docs/ledger/2026-11-10-ad-intraday-forecast-wire.md。派活 L4，写入 Grok 4.7。
