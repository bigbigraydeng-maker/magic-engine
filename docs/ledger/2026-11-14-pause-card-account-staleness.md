---
id: 2026-11-14-pause-card-account-staleness
title: 闲置广告账户的旧数据不再吞掉别的账户的暂停卡
status: done
owner: agent
decided_on: 2026-11-14
source: doc:docs/ledger/2026-11-09-ads-circuit-breaker-daily-hook.md
verify_by: 2026-11-15
verify_how: 次日每日拉数之后，在投账户仍会出暂停确认卡；闲置账户不再把整户的卡清掉。某个在投账户数据过期，只压住靠它数据的卡，并留下提醒。
done_on: 2026-11-14
done_ref: pr:3828
---
过期只看还在投放的账户：最近有花费，或新鲜快照里有在投的系列、广告组或广告。
闲置账户不标过期，也不挡住别的账户。
某个在投账户数据过期，只压住靠它数字的暂停卡；别的账户看得清的花费已经超上限时，卡仍然出。
快照按每个账户、每个层级最近一次抓全、再含当天早些时候的行来读，不再用前几百行历史判断设置是否读全。
