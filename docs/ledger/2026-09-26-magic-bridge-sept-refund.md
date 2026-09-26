---
id: 2026-09-26-magic-bridge-sept-refund
title: 把 CTS 9 月被 Magic Bridge 失败报告白扣的 0.96 美元免费额度退回（已执行，本月可再生成约 9 份报告）
status: done
owner: agent
decided_on: 2026-09-26
source: session:4bb834a6
done_on: 2026-09-26
done_ref: doc:docs/ledger/evidence/2026-09-26-magic-bridge-sept-refund--2026-09-26.md
verify_by: 2026-10-03
verify_how: 10/03 只读查 meta_ads_ai_sponsored_budgets 里 CTS 2026-09 这一行：spent_usd 应为 0.082714 加上 9/26 之后真实生成报告的花费（每份约 0.02），且不超过 1.25；若 10 月已开新行，9 月这行应停在该值不再变
---
PM 在本窗口回「退」。方案（逐条明细、守卫语句、回滚）：docs/specs/2026-09-26-magic-bridge-sept-refund-plan.md。
前提：按实扣费的修复（#2043）已先上线，退完不会再被失败白扣。
