---
id: 2026-09-25-ads-wp2-resolver-not-mounted
title: WP2 信封解析器没接进生产 Kernel、pre_provider 不读 kernel_pre 快照、4000 行窗口——归 3.1b 修
status: decided
owner: agent
decided_on: 2026-09-25
source: issue:1994
verify_by: 2026-10-09
verify_how: 架构测试「生产 Kernel 工厂 deps.resolveEnvelopeFacts 非空」进主干且绿；resolver 按 at=pre_provider 读 kernel_pre 快照有单测
---
子牙+狄仁杰 WP3 设计复审独立核出。生产无客户开 bounded_auto、无广告 runAction 调用方，今天不出事。
任何客户开自治前必须先修。修法在设计稿 §6.1/§12 3.1b。
