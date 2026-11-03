---
id: 2026-11-02-social-planning-context-readonly
title: 社媒只读 planning context：聚合 T+72、Tune 摘要与主页 rollup
status: done
owner: agent
decided_on: 2026-11-02
source: pr:3523
done_on: 2026-11-02
done_ref: pr:3523
verify_by: 2026-11-09
verify_how: 合并后 npm test -- src/lib/social/__tests__/planning-context.test.ts 全绿；缺数显示「没读到」、实测 0 显示 0；truncated 在查询顶 cap 时为 true
---
社媒 agent 差距报告 Issue B（B 级只读）：`src/lib/social/planning-context.ts` 的 `loadSocialPlanningContext` 拉 T+72 回执、Tune 同等建议和 `social.fb.*` 主页 rollup，供下周排期用。不接 Meta、不写 plan、不调 LLM；下一步才接 week-pack 批准前展示。
