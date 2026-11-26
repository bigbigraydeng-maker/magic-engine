---
id: 2026-11-10-creative-state-daily-cards
title: 每天拉完数出一次素材建议卡，自己不改预算
status: done
owner: agent
decided_on: 2026-11-10
done_on: 2026-11-10
done_ref: pr:3714
source: doc:docs/ledger/2026-11-10-ads-target-cpl-shared.md
verify_by: 2026-11-12
verify_how: 每日拉数任务跑完后，运行记录里能看到素材建议卡的张数。没点确认卡之前，广告和预算都不变。
---
挂在已经每天跑一次的拉数任务上，不另开一个定时器。只调用现有的出卡函数。
没有目标成本、快照过期、或读不到，就不出卡。出卡这一步不改广告、不改预算。
生产上的第一次自动跑还没发生。验的时候看第一次拉数回执，不要拿单元测试代替。
