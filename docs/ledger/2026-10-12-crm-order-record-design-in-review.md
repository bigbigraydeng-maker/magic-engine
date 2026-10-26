---
id: 2026-10-12-crm-order-record-design-in-review
title: CRM 订单记录设计稿 v0.4 已过两审两轮（均带条件通过，条件已并入），待 PM 批准；批准前不写代码不改生产库
status: decided
owner: pm
decided_on: 2026-10-12
source: session:f53ba28d
verify_by: 2026-10-19
verify_how: 看设计稿是否已过第二轮复审并由 PM 批准或否决；批准则另开实施窗口，否决则把需求卡 2026-10-12-crm-order-record-need-parked 的日期往后挪并写原因
---
设计稿：`docs/specs/2026-10-12-crm-order-record-design-v0.md`（A 级，新表加记钱）。最小第一步 = 4 张小表加录入工具加按出发日汇总的只读页，目标是 3 月四个团每团公司确认的已订人数。
接棒需求卡 `2026-10-12-crm-order-record-need-parked`；优先级按 §11 三维打分为 P0（PM 最新指示）。
待 PM 回答的第一个问题：第一版数据谁给（销售给表 或 我先从邮箱摸）。
