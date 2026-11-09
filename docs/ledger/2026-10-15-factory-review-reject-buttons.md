---
id: 2026-10-15-factory-review-reject-buttons
title: 工厂审片页补上打回按钮，并改成小卡流水线版面（删掉 Claude 对话框）
status: done
owner: agent
decided_on: 2026-10-15
source: session:f30b63dc
verify_by: 2026-10-17
verify_how: "PM 在线上 /dashboard/factory 对一条待审片点「打回」选理由提交，看顶部出现已打回提示且「已打回」分段里有这条；失败就把弹窗里的红字发给开发。"
done_on: 2026-10-15
done_ref: pr:2671
---
只改前端，调用既有 review 路由；打回不发布。PR 里有当场试跑记录（模拟接口点通，未连真实库）。
