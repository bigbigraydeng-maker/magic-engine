---
id: 2026-11-12-ad8-budget-raise-two-step-hints
title: 加日预算两步批准在确认卡和今日待办上串起指引
status: done
owner: agent
decided_on: 2026-11-12
source: session:ad8-budget-raise
verify_by: 2026-11-19
verify_how: 触发一张加预算确认卡并点第一次确认后，确认卡状态和今日待办都指向 /dashboard/kernel-approvals；kernel 点同意后，确认卡和今日待办都提醒回确认卡再点确认才执行。只改文案与待办，不改内核与执行。
done_on: 2026-11-12
done_ref: commit:pending
---

AD-8（B 级）：加预算先确认卡、再花钱负责人 kernel 批、再回卡二次确认。本卡只补 UI 提示与今日待办生成，叠在 AD-3 处方出卡之上。
