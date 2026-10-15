---
id: 2026-10-16-business-calculator-in-me-built
title: 经营测算器搬进 ME（CTS 客户页「经营测算」，手填、可存多场景对比）
status: decided
owner: agent
decided_on: 2026-10-16
source: session:8aade036
verify_by: 2026-10-23
verify_how: PM 回「合」并应用迁移后，在 CTS 客户页「经营工具」打开「经营测算」：默认值必须显示利润 $40,571、游客 720、打平 575 人；存两个场景、对比、改名、同名覆盖、删除各试一次；用非内部账号打开应被挡；本卡验过后改 verified
---
PM 2026-10-16 原话：「还是不要做成动态的了……只把这个计算器功能做到 ME，数据先不用打通。可以保存不同的模拟场景。」设计 docs/specs/2026-10-16-business-calculator-in-me-design-v0.1.md（子牙+魏征各审一轮，已吸收）。
代码在 PR 里，A 级（新表 me_calculator_scenarios）：迁移须 PM 回「合」才合并，合并后还要有人对生产库应用迁移（本机已用临时 Postgres 验过约束、50 个上限并发、RLS）。
