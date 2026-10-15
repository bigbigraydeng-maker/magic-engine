---
id: 2026-10-15-ads-readback-output-missing-applied
title: 另外四个广告动作的回读产物都缺注册表要求的 applied 字段
status: decided
owner: dev
decided_on: 2026-10-15
verify_by: 2026-10-22
verify_how: "逐个看 pause-unit.ts / pause-campaign.ts / cut-unit-budget.ts / cut-campaign-budget.ts / scale-unit-budget.ts 的 readback 步 output 里有没有 applied；并给每个加一条「最后一步产物满足注册表 required」的契约测试（照 swap-creative.test.ts 那条写）"
source: session:90a50c3b
---
事实：产物口径是最后一个成功步骤的 output（`kernel/gateway.ts` 的 `lastOutputOf`），注册表声明 `outputSchema.required = ['applied']`，而这几个动作的 readback 产物里没有 applied。
后果（按代码路径推演，未实跑）：动作其实做成了，却被判 INVALID_OUTPUT → 判失败 → 对 provider_native 自动触发撤回，并谎报失败。
为什么现有测试看不出来：三份测试都直接调 `capability.steps.*`，整条 kernel 判定没被覆盖。
已修：`ads.swap_creative`（PR #2695，含一条钉契约的测试）。其余四个本卡登记，另开 PR，别扩进 #2695。
