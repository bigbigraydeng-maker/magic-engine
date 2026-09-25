---
id: 2026-09-25-ads-wp2-envelope-facts-not-wired
title: WP2 受限自治一次都跑不通：内核组装没把信封事实解析器接进 deps，任何 bounded 广告动作授权必被拒；止损接口还有绕过内核的旁路
status: decided
owner: agent
decided_on: 2026-09-25
source: session:beef24ba
verify_by: 2026-10-02
verify_how: 一条 bounded 广告动作（如 ads.pause_unit）在 CTS 或 NAL 的真实 run 上通过授权（authorization_decisions 里有 allow 而不是 outside_autonomy_envelope）；且 grep 确认 ad-health/stop-loss 路由不再直调 setAdSetStatus/DailyBudget
---
2026-09-25 只读调查实锤：`src/lib/kernel/deps.ts:113-130 createKernelDeps` 不转发 `init.resolveEnvelopeFacts`，`kernel/index.ts:18-33 createKernel` 从不调 `createAdsEnvelopeFactsResolver`；
只有 `gateway.ts:901` / `authorize.ts:396` 在读它。测试全绕过 deps 直调 `preProviderEnvelopeBlockReason`，所以全绿。
旁路：`src/app/api/clients/[id]/ad-health/stop-loss/route.ts:48-50,124` 直调 Meta 写接口不经 Kernel。
这是 WP3 第一轮，A 级；接线点全图见 docs/specs/2026-09-25-ads-wp3-wiring-map.md。
