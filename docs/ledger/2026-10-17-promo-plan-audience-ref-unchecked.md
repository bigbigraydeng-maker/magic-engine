---
id: 2026-10-17-promo-plan-audience-ref-unchecked
title: 推广计划「受众」一栏填什么都不核对，计划写的受众和实际开投用的对不上时系统发现不了
status: decided
owner: agent
decided_on: 2026-10-17
source: session:ec90bb17
verify_by: 2026-10-24
verify_how: 设计稿：受众栏改成「已保存受众编号 / 目标人群条件」两选一，并在开投回读时核对实际用的受众；交 PM 看过再动手
---
105 号 10-17 查实：audience_ref 校验只有非空字符串，facts.ts / board.ts 无任何核对。计划与实际开投脱节，系统不会报。
归做推广计划页的窗口（116 号方向）。同时：官方账户日上限 30 与草稿预算 101 对不上由服务端闸挡住，是对的，别绕。
