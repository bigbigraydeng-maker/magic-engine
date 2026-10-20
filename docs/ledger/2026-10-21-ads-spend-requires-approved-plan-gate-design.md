---
id: 2026-10-21-ads-spend-requires-approved-plan-gate-design
title: 没有已批准的推广计划就不许开投/激活/加预算：硬规则设计要点（只设计，未写代码）
status: decided
owner: agent
decided_on: 2026-10-21
source: pr:3010
verify_by: 2026-10-28
verify_how: 子牙+魏征审过设计后才进实现；实现后试跑：把某测试客户的计划退回草稿，approveDraft 应被拦并写回执；每日扫描应对"无计划却在投"出红色待办。
---
A 级设计稿，PM 2026-10-21 指出"流程反了，应先批计划再开投"。只设计，不含代码。
