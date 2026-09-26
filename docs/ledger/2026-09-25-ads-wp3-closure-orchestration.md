---
id: 2026-09-25-ads-wp3-closure-orchestration
title: 广告全自治 WP3 闭环编排：Inngest 事件链 + 孔明/韩信 + Check/Tune + Jev + 五段日检 + 开关同步 + 熔断落点；归 ME 广告构建控制窗口，DeepSeek 写、子牙/魏征审
status: decided
owner: pm
decided_on: 2026-09-25
source: session:beef24ba
verify_by: 2026-10-06
verify_how: 按 spec §11 WP3 条：一条真实处方（CTS 或 NAL）走完 proposed → executed → readback → verification → memory，action_runs / flywheel_outcomes / client_proven_patterns 各一行且 id 互相关联，Inngest 后台可见全链 receipt；且把 daily_budget_cap_cents 调低后下一轮动作被拒 + 三件套出现在待办
---
PM 2026-09-25「先做全自治，用 DeepSeek 开发；开 CTS NAL」，随后拍板「那边做」——归「ME 广告构建控制」窗口（会话 0a9daab4）。
设计以 PR #1956 的 spec §3 G6–G11、§7 WP3 为准；接线点全图 docs/specs/2026-09-25-ads-wp3-wiring-map.md（beef24ba 窗口 9-25 摸清）。
前提未满足即不动：两客户 goals 空、daily_budget_cap_cents 空、creative_pool 空——三样数字等 PM 给。A 级：子牙+魏征设计前后各审一次，狄仁杰看开关同步。
