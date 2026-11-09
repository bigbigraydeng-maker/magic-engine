---
id: 2026-11-09-ads-circuit-breaker-propose-pause
title: 广告异常只出暂停确认卡，系统自己不暂停
status: decided
owner: agent
decided_on: 2026-11-09
source: doc:docs/ledger/evidence/2026-11-03-ads-impact-25-packages-audit.md
verify_by: 2026-11-12
verify_how: 用一份假数据跑判定，花费超每天上限时应出暂停卡且没有改广告；快照超过 12 小时只出提醒。
---
异常只提议暂停已有的广告系列确认卡，并给负责人一条待办。确认卡点下去才会改广告。
快照旧不旧看抓取记录。花费、无线索、政策问题才出卡；数据太旧只提醒。
默认倍数是两倍、快照 12 小时，客户可在现有配置里改严，不能改成 0。
不写会把后续暂停也拦住的熔断闸门行，事件记在现有动作账上。
不做编排扩展。规则仍待确认，上线后看第一次自动检查。
