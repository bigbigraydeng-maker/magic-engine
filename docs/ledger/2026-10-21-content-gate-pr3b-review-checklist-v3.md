---
id: 2026-10-21-content-gate-pr3b-review-checklist-v3
title: 内容实质闸第三步之二（审片页）：审批清单加「这条单独发给粉丝，他们能看懂在讲什么」（V3，带版本号防降级），素材单独分区只能入库不能通过，remotion 单打回不再重开新单
status: decided
owner: agent
decided_on: 2026-10-21
source: pr:3019
verify_by: 2026-10-28
verify_how: 合并部署后：①审批页对一条普通成片点「通过」必须逐项/一键勾选「能看懂」才放行，批准后 review_ref 带 checklist_version=v3；②标 asset_only 的工单出现在「素材（不单独发布）」分区、没有通过按钮，点「收入素材库」变 archived 且 asset_accepted_by 有值，直接调 approve 仍是 409；③切换日 2026-10-23 之后批准的回执必须带版本号才能发布（防降级）；④remotion 单打回后不会生成死单（reopened_work_order_id=null）。
---
设计稿 §10.4/§11（PR 2716 分支）。V3 清单 = V2 + standalone_understandable（审片页一键面板与逐项面板都「不预勾、全部标为通过不替人勾」）；humanKeysForReviewRef 读 review_ref.checklist_version：带版本号=V3（缺新项=无效，不降级）、批准时间≥2026-10-23 且无版本号=V3（V2 形状的回执不能再发布）、此前的老回执按旧口径继续能发。已知局限：这一项只能靠人，机器闸只保证「有字」。**部署必须早于切换日**（2026-10-23T00:00Z = 新西兰 10-23 13:00），否则旧界面在切换日后批准的 V2 形状回执会被发布环节判缺项并置终态（不自动重试）。已知缺口（本 PR 不修）：TikTok 发布路由与 YouTube 暂存入口只验状态不验清单/版本；素材入库后 archived 在看板阶段统计里仍算「发布后收尾」；审批页顶部待审数仍把素材单算进去；切换日后要清点残留的 V2 approved 老单。
