---
id: 2026-11-09-ads-plan-delivery-stage-missing-todo
title: 缺投放阶段时待办提醒，收回稳住写明跳过原因
status: decided
owner: agent
decided_on: 2026-11-09
source: doc:docs/ledger/2026-11-10-ads-plan-stage.md
verify_how: 合并后「已批准 promo、在投、无 delivery.stage」客户应出现 decide 待办；每日拉数 scale_fallback 的 skipped 含 no_delivery_stage。P-4 creative_state 不读计划阶段，缺阶段时仍照常跑。
---
待办 `ads_plan_delivery_stage_missing`；判定见 `approved-delivery-stage.ts`；收回只在 `scale-fallback/run.ts` 写 `no_delivery_stage`。
对应 PR：pr:3724。
