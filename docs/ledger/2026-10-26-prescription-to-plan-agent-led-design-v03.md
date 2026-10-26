---
id: 2026-10-26-prescription-to-plan-agent-led-design-v03
title: 处方→推广计划草稿（广告 Agent 主导）设计稿 v0.3：种子由 Agent 从系统事实产出，送子牙魏征审后再给 PM 看方向
status: decided
owner: agent
decided_on: 2026-10-26
source: pr:3191
verify_by: 2026-11-02
verify_how: 子牙+魏征各审一轮 docs/specs/2026-10-26-prescription-to-promo-plan-draft-design-v0.1.md（稿头标 v0.3），结论回 74，再给 PM 看方向；审过前不写代码。核心：plan_seed 由广告 Agent 出处方时用确定性取数构建器产出（复用 draftAdsStep/Suggestion），取不到留空写原因；仍只生成草稿、PM 批准、不自动建 Meta 对象。到期前确认已审或已改版。
---
PM 2026-10-26 原话：「继续修复 prescription 到广告计划的全链条！让 ME 的广告 Agent 做主导！」——取代之前的暂停。纯设计稿，功能风险 A 级，工作量约 7.5–10 天，建议拆 3 个 A 级 PR。
