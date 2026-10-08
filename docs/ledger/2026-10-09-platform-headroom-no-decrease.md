---
id: 2026-10-09-platform-headroom-no-decrease
title: 平台缺口：预算余量函数表达不了减预算，也不查分账户上限
status: decided
owner: pm
decided_on: 2026-10-09
source: session:4544d90e
verify_by: 2026-10-16
verify_how: 确认余量函数能接受负向调整并检查分账户上限，且 envelope-facts 与 diagnostics/context 两处口径已同步
---
computeLaunchHeadroom 遇到负的调整直接拒绝，分账户上限只输出不判定。改动属 A 级连带，需另开任务。
明细见 doc:docs/clients/cts/2026-10-09-budget-two-step-preflight-blocked.md
