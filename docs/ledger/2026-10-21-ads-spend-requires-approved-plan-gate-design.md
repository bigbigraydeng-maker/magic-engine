---
id: 2026-10-21-ads-spend-requires-approved-plan-gate-design
title: 没有已批准的推广计划就不许开投/激活/加预算：硬规则设计要点（只设计，未写代码）
status: decided
owner: agent
decided_on: 2026-10-21
source: pr:3010
verify_by: 2026-10-28
verify_how: 子牙+魏征审过设计后才进实现；实现后按 v0.4 §8 + v0.6 §1/§3/§4 验收：无计划或读库失败时 pause、减预算仍放行；无计划时 approveDraft 被拦并写回执；占位后计划被退回草稿则草案回到 awaiting_approval；budget_move_plan 整体判一次不半截；每日扫描对无计划却在投出红色待办（回填前对老广告只出待办不拦）。
---
A 级设计稿，PM 2026-10-21 指出"流程反了，应先批计划再开投"。只设计，不含代码。
