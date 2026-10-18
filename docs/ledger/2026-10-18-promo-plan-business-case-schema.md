---
id: 2026-10-18-promo-plan-business-case-schema
title: 推广计划加了经营判断卡、实验设计卡、销售承接三块字段（只加结构，还不拦批准）
status: done
owner: agent
decided_on: 2026-10-18
done_on: 2026-10-18
done_ref: pr:PENDING
source: session:579d2d02
verify_by: 2026-10-25
verify_how: 在真实推广计划页填一张经营判断卡并保存成功，再读库确认 plan_data.promo.phases[].business_case 有值；且已批准的旧计划的「批准记录」仍显示「批准的就是现在这一版内容」（没有因为加字段被判成内容变过）
---
设计稿：docs/specs/2026-10-18-promo-plan-business-case-and-gates-design-v0.1.md（PR 2779）。这是其中的 PR①-a：只加 schema 和测试，不碰批准闸、不碰表单。
一个坑记下来：`is_experiment` 一开始写的是 `z.boolean().default(false)`，结果 default 会被写进解析结果，让每一份旧计划的内容指纹都变一次——已批准的计划会被判成「内容变过了」，挂在旧指纹上的人工核实记录也会跟着作废（当场被 approval-record 测试照出来）。改成 `.optional()`，按 `=== true` 读。
