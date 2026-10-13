---
id: 2026-10-14-publishing-calendar-intake-and-selection-automatic
title: PM 定：发布日历的报名与挑选都要自动，人工只保留每周一次授权
status: decided
owner: pm
decided_on: 2026-10-14
source: pr:2549
verify_by: 2026-10-21
verify_how: 一周的内容从产出到授权没有人在窗口之间搬文件；日历上每条都有一行「为什么排在这里」；PM 当周只点过一次授权，没有做过别的人工步骤
---
PM 原话：按这个做，但是报名和挑选我希望都是自动化。
落法：各内容来源按排程自己写候选（排期 agent、视频工厂工单过审、每日计划产出），导入脚本退役。
挑选从第一天起全程程序：硬规则 + 按角色排时段；模型只是超额分支的一个零件，不超额时用明规则并留好接口。
唯一保留的人工是 PM 授权，对外发布撤不回必须有人点头；自动授权进明确不做清单。
设计稿 docs/specs/2026-10-14-publishing-calendar-design.md v0.3，只有文档。
