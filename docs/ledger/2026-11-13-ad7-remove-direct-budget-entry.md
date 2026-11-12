---
id: 2026-11-13-ad7-remove-direct-budget-entry
title: 任务页抽屉不再直接改日预算
status: done
owner: agent
decided_on: 2026-11-13
source: session:9c129e32
verify_by: 2026-11-20
verify_how: 任务页广告抽屉里没有调整日预算。对执行接口发下调预算得到拒绝，不排队、不改广告平台。暂停和恢复仍只出确认卡。
done_on: 2026-11-13
done_ref: doc:docs/ledger/2026-11-13-ad7-remove-direct-budget-entry.md
---
Ray 2026-11-13 01:28 NZDT 批准：改广告只能走确认卡。
任务页抽屉去掉直接下调日预算。执行接口的这条直改也拒绝，不再排队。
旧的预算队列收到事件也直接拒绝，不再写广告平台。
暂停和恢复仍只出确认卡。闸门、额度和权限边界没改。PR 未开，所以没写 pr:pending。
