---
id: 2026-11-10-scale-fallback-daily-card
title: 每天拉完数可以提议把日预算收回去
status: done
owner: agent
decided_on: 2026-11-10
done_on: 2026-11-10
done_ref: pr:3718
source: doc:docs/ledger/2026-11-10-scale-fallback-steady-card.md
verify_by: 2026-11-12
verify_how: 每日拉数任务跑完后，运行记录里能看到收回建议的张数。没点确认卡之前，预算不变，广告也不暂停。
---
挂在已经每天跑一次的拉数任务上，不另开定时器。只出确认卡。
点确认也不会改预算。不暂停，不加预算。
读不到、快照过期、或收回后会超过每天上限，就不出卡。
生产上的第一次自动跑还没发生。验的时候看第一次拉数回执，不要拿单元测试代替。
