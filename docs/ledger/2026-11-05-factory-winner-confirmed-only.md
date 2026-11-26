---
id: 2026-11-05-factory-winner-confirmed-only
title: "视频工厂只认程序复核通过、有权的人点过「认」的广告赢家（赢家闭环第 1 刀）"
status: decided
owner: agent
decided_on: 2026-11-05
source: doc:docs/specs/2026-11-05-ads-winner-learning-loop-design-v0.md
risk: A
verify_by: 2026-11-12
verify_how: "合并部署后打开视频工厂页并选 CTS（/dashboard/factory?client=CTS）的「当前广告样板」那一块：上海团那条显示「复核没完成：拿不到原视频，这条现在不能用」且没有认按钮；接口 GET /api/factory/winners 返回 200 且这条 state=unusable、reason=program_check_not_passed；今日待办没有这条（复核没通过不进）。另造一条测试客户的 passed 赢家点「认」后状态变「已认」、pm_decision 有 by/role/event_id/at 回执"
---

第 1 刀：共享读取闸（关闭即失败：复核不是 passed、没人认、回执对不上、确认人没资格、客户只认 PM 时员工确认的、结果种类不明、缺单次成本都不用）；挑赢家按同一结果种类内的单次成本；「认 / 不认」接口（PM 或该客户员工，员工改不了 Magic Lab 的决定，决定留历史，PM 推翻员工认过的 → 赢家行标记 + 客户设置只认 PM）；工厂页「当前广告样板」；今日待办每客户每周最多一条、最多两轮（只有每日邮件路径开轮，读路径不写）；Winner Intake 按客户全称精确匹配。
11-04 那条（见 PR 正文）复核 needs_human（拿不到原视频），所以现在不能用、不进待办。
后续事项（不在本 PR 做）：出片机领单时再核一次、`review-apply.ts` 重开工单继承赢家编号不经闸（都归第 2 刀）；「只认 PM」开关原子合并要新建数据库函数（迁移，A 级，Ray 亲手合），`factory-config` 保存接口可能冲掉开关；把开关关回去的界面；全局管理员判据抽公共函数；截图上传、员工入口、拿到原视频后补跑马良复核。
