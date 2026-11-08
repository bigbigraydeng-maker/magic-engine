---
id: 2026-11-02-adset-daily-budget-card
title: 一张确认卡才能改一个广告组的日预算，改完要回读对上才算做成
status: done
owner: agent
decided_on: 2026-11-02
source: session:ae23441a
verify_by: 2026-11-09
verify_how: 草稿合并前先看相关测试：正好落在允许幅度上可以通过，再多一档不行；别的账户正在花的预算要算进客户总上限；卡上的现预算和回读不一致就停、不改；改完回读对不上就标失败且不再写第二次。合并后用测试账户点一张卡，确认前后各看一次广告组日预算。
done_on: 2026-11-02
done_ref: pr:3516
---

这张卡原先自己写日预算。那条写入不合并。
改成批准后的处方出步骤卡，执行复用已有预算路径。见 2026-11-08-budget-step-card-reuses-kernel。
