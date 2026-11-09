---
id: 2026-10-06-factory-chat-reject-remotion-honest
title: 审核页对话框对"模板出片"的片子不再假装能打回重做，改成如实告诉 PM 做不了
status: decided
owner: agent
decided_on: 2026-10-06
source: session:4d162566
verify_by: 2026-10-13
verify_how: 合并后在 /dashboard/factory 找一条模板出片的待审单，对话框说"这条节奏太慢打回"，应回「这条是模板出片，对话框改不了画面…」且那条单仍在待审、没多出新单。生产上要有至少 1 条模板出片待审单才能判；没有就写明判不了。
---
改动：src/lib/factory/chat.ts（打回工具先查 brief.remotion，是就拒绝）+ render-mode.ts + FactoryChat.tsx（空回复显示明确失败提示）。
遗留（未做，本轮不在范围）：后台 /review 页面的「打回」按钮走同一个 applyQualityReject，对模板出片单同样会假成功，需另开一张卡。
