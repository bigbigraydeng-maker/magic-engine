---
id: 2026-11-05-factory-winner-confirmed-only
title: "视频工厂只认人点过「认」的广告赢家（赢家闭环第 1 刀）"
status: done
owner: agent
decided_on: 2026-11-05
source: doc:docs/specs/2026-11-05-ads-winner-learning-loop-design-v0.md
risk: B
verify_by: 2026-11-12
verify_how: "合并部署后打开 /dashboard/factory?client=c0000000-0000-0000-0000-000000000000#current-winner，看到当前赢家（上海团 18 秒价格开头那条）与状态「等你认」；今日待办出现一条「这条广告样板要不要认」；点「认」（勾看过截图）后状态变「已认」、今日待办那条消失、winner_structures.performance.pm_decision 有 by/role/event_id/at 回执"
done_on: 2026-11-05
done_ref: pr:pending
---

第 1 刀：共享读取闸 `loadUsableWinners`（关闭即失败：没复核、没人认、回执对不上、缺单次成本都不用）；工厂挑赢家改按每个结果的成本；「认 / 不认」接口（PM 或该客户员工，回执记谁点的，PM 推翻一次的判定已备好）；工厂页「当前广告样板」一块；今日待办每客户最多一条、两周后不再提醒；Winner Intake 改为客户名精确唯一匹配。
11-04 那条（86948d4f）复核结论写入 needs_human（拿不到原视频），要人看截图核对后点认。截图上传接口已就绪，截图待上线后上传。
后续事项：出片机领单时再核一次（第 2 刀，改出片机会升 A 级）；截图上传；员工从客户后台进入这一块的入口。
