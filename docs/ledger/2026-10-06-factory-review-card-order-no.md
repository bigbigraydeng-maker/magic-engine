---
id: 2026-10-06-factory-review-card-order-no
title: 审核卡片和通过弹窗显示工单号前 8 位并可一键复制（PM 点错工单后的根子修复，只改显示）
status: done
owner: agent
decided_on: 2026-10-06
done_on: 2026-10-06
done_ref: pr:2328
source: session:619710c8
verify_by: 2026-10-13
verify_how: PM 在看板打开一条待审片，卡片上能看到「工单 xxxxxxxx」，点一下提示「已复制」，通过弹窗标题处同样显示
---
统筹 2026-10-06 要求先于弹窗简化合并。只改显示，不碰审核/授权逻辑，B 级。合并后改 done 补 done_ref。
实现 PR：pr:2320（已合并）；done_ref 指向本收尾 PR，因为台账门禁要求改卡的 PR 必须被一张卡指向。
