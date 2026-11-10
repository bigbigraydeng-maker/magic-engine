---
id: 2026-11-10-scale-fallback-steady-card
title: 放量之后按客户目标判断要不要收回日预算
status: done
owner: agent
decided_on: 2026-11-10
done_on: 2026-11-10
done_ref: pr:3716
source: doc:docs/ledger/2026-11-10-creative-state-daily-cards.md
verify_by: 2026-11-12
verify_how: 用假数据跑判断。连续两天成本高于目标，或刚结束的那天花了一半预算且没有留资，才会给出收回金额。快照过期或超过每天上限则没有建议。判断不改预算。
---
只判断，不出卡，也不改预算。出卡挂在每天的拉数任务上，另记一笔。
收回金额是这段连续加预算开始之前的日预算。对不上、时间重复、或会超过已批准的每天上限，就没有建议。
不暂停，也不加预算。
