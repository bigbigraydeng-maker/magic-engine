---
id: 2026-11-09-ads-circuit-breaker-daily-hook
title: 每日拉数之后提议暂停确认卡
status: decided
owner: agent
decided_on: 2026-11-09
source: doc:docs/ledger/2026-11-09-ads-circuit-breaker-propose-pause.md
verify_by: 2026-11-12
verify_how: 每日拉数任务跑完后，异常客户的动作账上有一条提议，确认卡未点时广告状态不变。
---
每天拉完数就跑一遍判定。超限、无线索或政策问题就申请已有的暂停系列确认卡。
快照超过 12 小时只记提醒。系统自己不改广告。
待办指向这个客户的广告页，请负责人点确认卡。聊天里答应不算。
事件记在现有动作账，不新开表，也不写会挡住后续暂停的闸门行。
这条接在判定那张卡后面。规则仍待确认。
