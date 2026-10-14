---
id: 2026-10-09-platform-headroom-no-decrease
title: 平台缺口：分账户上限只输出不判定；减预算须有有序执行契约才能计入余量
status: decided
owner: pm
decided_on: 2026-10-09
source: session:4544d90e
verify_by: 2026-10-16
verify_how: 确认分账户上限已参与判定；若要支持减预算，必须先有强制“先减、读回确认成功、再算增加”的有序执行契约，否则余量函数继续拒绝负数（不得用未验证的减预算制造余量）；envelope-facts 与 diagnostics/context 两处口径已同步
---
computeLaunchHeadroom 遇到负的调整直接拒绝（目前这是安全的：减预算写入或读回失败时负数会制造不存在的余量），分账户上限只输出不判定。改动属 A 级连带，需另开任务。
明细见 doc:docs/clients/cts/2026-10-09-budget-two-step-preflight-blocked.md
