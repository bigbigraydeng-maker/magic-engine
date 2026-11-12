---
id: 2026-11-12-social-week-plan-goal-card-fields
title: 周计划读出完整目标卡文字供出稿背景
status: done
owner: agent
decided_on: 2026-11-12
done_on: 2026-11-12
done_ref: pr:3812
source: doc:docs/specs/2026-10-29-social-goal-driven-impact-loop-v1.md
verify_by: 2026-11-19
verify_how: 跑 weekly-plan 测试：完整目标卡写入 draftBasis；只有标题时行为与以前一致；没有卡不报错也不编。
---
只读 goals 表里已有的文字和分类字段，不读目标数字和花费。缺字段就跳过那一行。
