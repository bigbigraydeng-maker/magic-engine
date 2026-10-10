---
id: 2026-09-29-daily-plan-standalone-entry
title: 每日计划从推广活动页面拆成独立入口
status: done
owner: agent
decided_on: 2026-09-29
source: session:5a6abe7a
verify_by: 2026-10-03
verify_how: PR 合并上线后，打开任意一个有进行中推广活动的客户，访问 /dashboard/clients/<id>/daily-plan，确认页面正常渲染 Visual Direction 区块和七日审核网格（不报错、不是空白页）；再从该客户推广活动卡片里点"每日计划"链接，确认带着正确的活动参数跳转过去。
done_on: 2026-09-29
done_ref: pr:2197
last_checked: 2026-10-09
check_note: 夜巡盖章：done_ref 指向的 PR 已合并（或为文档/提交型指向），但 verify_how 要求的实证本晚未取到，不翻状态
---
PM 口头拍板：把嵌在"推广活动"卡片展开层里的"每日计划"（Facebook Post 七日排期审核）拆成独立路由，从客户页面"概览"和"工具"标签都能直达。新页面把 Visual Direction（调性/配色）跟审核网格放在一起，不丢失审核时需要的上下文。纯 UI 重组，未改数据模型和接口。
本窗口 worktree 无数据库连接权限，未能做真实数据的浏览器点击验证，列入 verify_by 待补验。
