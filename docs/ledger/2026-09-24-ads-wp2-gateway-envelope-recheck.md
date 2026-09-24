---
id: 2026-09-24-ads-wp2-gateway-envelope-recheck
title: 广告受限自治必须有两处实例闸：授权时 + 碰 Meta 之前用 kernel_pre 快照再算一次；三方复审通过
status: done
owner: agent
decided_on: 2026-09-24
source: session:31cdcfa9
verify_by: 2026-09-28
verify_how: PR #1979 已合并且迁移 kernel_recovery_outside_autonomy_envelope 已 apply；变异测试「删 gateway.ts 的 preProviderEnvelopeBlockReason 分支 → pre-provider-envelope.test.ts 最后一条变红」可复现；4 家客户 autonomy_mode 仍为 observe
done_on: 2026-09-24
done_ref: pr:1979
---
复审发现实施只接了 authorize 一处，三处注释与类型签名却断言 gateway 层已查；补丁 c7f63897 加 preProviderEnvelopeBlockReason，1079c1a4 改正注释。
遗留给 WP3：ad_strategy_configs.autonomy_mode 与 client_automation_policies.mode 目前零同步，必须显式设计。
