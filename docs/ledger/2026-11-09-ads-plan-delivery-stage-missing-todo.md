---
id: 2026-11-09-ads-plan-delivery-stage-missing-todo
title: 缺投放阶段时待办提醒，收回稳住写明跳过原因
status: decided
owner: agent
decided_on: 2026-11-09
source: issue:github
verify_how: 合并后「已批准 promo、在投、无 delivery.stage」客户应出现 decide 待办；每日拉数 scale_fallback 的 skipped 含 no_delivery_stage。P-4 creative_state 不读计划阶段，缺阶段时仍照常跑。
---
纯读：待办 `ads_plan_delivery_stage_missing`；判定 `approved-delivery-stage.ts`；收回只在 `scale-fallback/run.ts` 短路 `no_delivery_stage`。

## 当场试跑
触发：`npm test -- src/lib/marketing-plan/promo/__tests__/approved-delivery-stage.test.ts src/lib/pm-todo/__tests__/ads-plan-delivery-stage-items.test.ts src/lib/ads-strategy/scale-fallback/__tests__/run.test.ts`
时间：2026-11-09（订正后）
状态/退出码：2026-11-09 订正后本地 vitest 4 文件 13 例，退出码 0。
