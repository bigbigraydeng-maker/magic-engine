---
id: 2026-11-05-factory-winner-confirmed-only
title: "视频工厂只认程序复核通过、有权的人点过「认」的广告赢家（赢家闭环第 1 刀）"
status: decided
owner: agent
decided_on: 2026-11-05
source: doc:docs/specs/2026-11-05-ads-winner-learning-loop-design-v0.md
risk: A
verify_by: 2026-11-12
verify_how: "合并部署后打开 /dashboard/factory?client=c0000000-0000-0000-0000-000000000000#current-winner：上海团那条显示「复核没完成：拿不到原视频，这条现在不能用」且没有认按钮；接口 GET /api/factory/winners 返回 200 且这条 state=unusable、reason=program_check_not_passed；今日待办没有这条（复核没通过不进）。另造一条测试客户的 passed 赢家点「认」后状态变「已认」、pm_decision 有 by/role/event_id/at 回执"
---

第 1 刀：共享读取闸（关闭即失败：程序复核不是 passed、没人认、回执对不上、确认人不在名单、结果种类不明、缺单次成本都不用）；照赢家出片按同一结果种类内的单次成本挑；题材防撞护栏仍看全部在跑的赢家；「认 / 不认」接口（PM 或该客户自己的员工，受限管理员不行，员工改不了 Magic Lab 的决定，决定留历史；PM 推翻员工认过的 → 客户配置改成只认 PM）；工厂页「当前广告样板」一块；今日待办每客户每周最多一条、最多两轮；Winner Intake 改为客户名精确唯一匹配。
11-04 那条（86948d4f）复核结论 needs_human（Meta 只读拿不到原视频：download_hd_url 为空；Dropbox 搜不到），所以现在不能用、不进待办。
后续事项（不在本 PR 做）：
- 出片机领单时再核一次（第 2 刀）；截图上线后上传；员工从客户后台进入这一块的入口；拿到原视频后补跑马良 v2 复核。
- `review-apply.ts:266` 重开工单会把旧工单的 `winner_structure_id` 原样带过去，不经赢家闸（赢家后来被撤认也照继承）——第 2 刀改出片机时一并收口。
- 客户设置里「只认 PM」开关的写入：`clients` 表没有 `updated_at` / 版本号，本 PR 只能读后写；要原子合并需新建数据库函数（迁移，A 级，Ray 亲手合）。生效靠赢家行上的 `pm_only_required` 标记，开关只是镜像。
- `factory-config` 保存接口可能冲掉 `winner_confirm_pm_only`（同样建议改成比对后写），属另一条路由。
- 把「只认 PM」关回去的设置界面（第 2 刀）。
- 全局管理员判据抽成公共函数；决定接口的鉴权分支目前靠本 PR 的路由测试覆盖。
- Winner Intake 填表要写客户全称（如 CTS Tours NZ）：按名字精确匹配、唯一命中才收。
