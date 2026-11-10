---
id: 2026-11-10-ad-intraday-spend-samples
title: 广告账户当地每 10 分钟记一笔今天的花费，给收盘预测用
status: decided
owner: agent
decided_on: 2026-11-10
source: doc:docs/ledger/2026-11-10-ad-intraday-spend-samples.md
verify_by: 2026-11-13
verify_how: 表套用并且这张卡对应的改动进主干后，运行记录里能看到 ad-intraday-spend-sample 有完成的一轮；广告健康页的花费收盘预测不再整段说没有样本。预测高于已批准计划的每天上限时，待办里出现超限提醒。表还没套用就不算失败。
---
Ray 已同意做日内花费采样，并同意新增一张表。
采样挂在现有的频繁调度上，账户当地每 10 分钟读一次今天的花费，只读，不改广告。
样本留给已有的收盘预测和广告健康页；预测超过已批准计划的每天上限时，走现有超限提醒。
样本保留 14 天。表要等亲手套用后才会在线上写入。
