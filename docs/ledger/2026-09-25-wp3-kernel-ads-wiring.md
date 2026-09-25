---
id: 2026-09-25-wp3-kernel-ads-wiring
title: 广告自治 WP3 接线通电 — Kernel 接线缺陷修复 + 熔断器 + 架构边界补全
status: done
owner: agent
decided_on: 2026-09-25
source: session:dcc2476b
verify_by: 2026-09-29
verify_how: bounded_auto 客户的 ads.pause_unit 动作不再被 Kernel unconditionally deny；熔断器纯函数 7 条测试全绿；集成测试 6 条全绿；boundaries.ts 架构测试捕获直接 Meta 写入
done_on: 2026-09-25
done_ref: pr:2019
---
WP2 合并后发现四个接线缺陷导致 bounded_auto 授权永远失败：createKernelDeps 漏传 resolveEnvelopeFacts、createKernel 从未安装 resolver、Meta 广告写入模块未纳入架构边界、stop-loss 绕过 Kernel。本 PR 修前两个并补架构边界，新增熔断器纯函数和 pm-todo 管道。
