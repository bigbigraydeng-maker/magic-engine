---
id: 2026-09-28-circuit-breaker-undeterminable-not-failclosed
title: 熔断器"数据不充分"时维持现状而不是自动收紧——这是既有 spec 决定，不是本轮漏做
status: decided
owner: pm
decided_on: 2026-09-28
source: session:dcc2476b
verify_how: 无需验证——这是记录一次设计权衡的决定，不是等待发生的事实；只有 PM 或产品明确要改"不熔不放"这条判据时才需要新开一张卡跟进实现
---
Codex 复审 PR #2019 时建议：新账户或低量账户不足 5 个非零历史日（`undeterminable`）时，运行时调用方应该主动把动作切到非自动状态，而不是维持 `auto_approve` 原样。

这条建议**直接违反已经评审过的既有设计**：`circuit-breaker.ts` 的 `CIRCUIT_BREAKER_MIN_NONZERO_DAYS` 判据明确写着"不熔不放"（`docs/specs/2026-09-25-ads-impact-wp3-design-v1.md` §6.3 #1），且这条判据本身在更早一轮已经过 9 条测试验证。这次没有采纳 Codex 的建议去改——不是漏做，是因为改了会推翻一个已经拍过板的产品权衡（数据不足默认收紧 vs 默认维持现状），这个权衡该由决定原 spec 的人（或 PM）改，不该由复审 agent 顺手翻案。

真实的空档：一个新客户开 `bounded_auto` 且暂时没有 5 天花费历史时，熔断器在这段时间完全帮不上忙——如果这是要收紧的风险点，需要 PM 或产品拍板要不要改"不熔不放"这条判据，而不是当 bug 修。
