---
id: 2026-11-05-winner-panel-moved-to-ads-health
title: "「当前广告样板」从视频工厂页搬到客户广告健康页的「广告样板」标签"
status: decided
owner: agent
decided_on: 2026-11-05
source: doc:docs/specs/2026-11-05-ads-winner-learning-loop-design-v0.md
risk: B
verify_by: 2026-11-12
verify_how: "合并部署后打开 CTS 广告健康页（/dashboard/clients/CTS/ads-health?tab=winners）：标签栏「每条广告」后面有「广告样板」，点开能看到当前广告样板那一块；视频工厂页只剩一条小链接「当前广告样板在广告页 →」，点它落到同一个标签；今日待办「这条广告样板要不要认」的链接也落在这个标签"
---

面板代码原样搬家（接口和权限不动），标签名与链接只在一处定义（`src/lib/factory/winner-links.ts`）；工厂页只留小链接，待办链接改指新标签，各有测试。
更合适的落点可能是每周推广计划页（`clients/[id]/promo-plan`），先放广告健康页，等 PM 定。
上海团那条赢家：确定性检查已全过，马良 v2 没跑（本机没有模型钥匙），状态仍是「需人核」。
后续事项（第 2 刀设计时二选一，本 PR 不做）：马良 v2 需要服务器侧复核通道、不靠本机钥匙。
候选：走现有收片入口把原视频收为工单由服务器上的马良审（顺带补进工厂审查记录），或新增仅管理员可调的「复核赢家」接口。
