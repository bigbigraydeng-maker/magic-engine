---
id: 2026-10-26-prescription-to-plan-draft-design
title: 处方→推广计划草稿自动生成：设计稿 v0.1（只设计，待子牙魏征审，审过前不写代码）
status: decided
owner: agent
decided_on: 2026-10-26
source: pr:3180
verify_by: 2026-11-02
verify_how: 子牙+魏征对设计稿 docs/specs/2026-10-26-prescription-to-promo-plan-draft-design-v0.1.md 各审一轮，结论回 74；核心判断：处方里没有结构化账户/日预算/受众，必须先加 plan_seed（块 0），生成器只读种子、不解析摘要；触发用计划页按钮「按处方起草」；只生成草稿。到期前确认已审或已改版。
---
纯设计稿，功能风险 A 级。不含代码。
