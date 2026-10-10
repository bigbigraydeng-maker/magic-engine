---
id: 2026-10-02-ads-o1-budget-scale-production-test
title: O1 预算建议经人工批准后完成生产验证
status: decided
owner: agent
decided_on: 2026-10-02
source: doc:docs/ledger/2026-09-30-ads-campaign-budget-first-run.md
verify_by: 2026-10-03
verify_how: 部署后核对最新 O1 数据与实际 Meta 预算；如符合条件，按已批准金额提交一次人工审批，确认 Inngest 执行、Meta 回读和 Kernel 回执一致；不符合条件或任何校验失败时不写预算。
---

代码只允许把预算建议交给人工审批；审批通过后才排队执行。Meta 分页读取失败、归属/投放状态不明、客户上限超出或预算基线变化时必须停止。真实结果待部署后记录。
