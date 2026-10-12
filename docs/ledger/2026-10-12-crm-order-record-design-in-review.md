---
id: 2026-10-12-crm-order-record-design-in-review
title: CRM 订单记录设计稿 v0.9 改为复用已上线的订单与付款进度（crm_bookings），只补来源与发票号两列和销售进度只读页；待第四轮复审后转 PM 批准；批准前不写代码不改生产库
status: decided
owner: pm
decided_on: 2026-10-12
source: session:f53ba28d
verify_by: 2026-10-19
verify_how: 看设计稿是否已过第二轮复审并由 PM 批准或否决；批准则另开实施窗口，否决则把需求卡 2026-10-12-crm-order-record-need-parked 的日期往后挪并写原因
---
设计稿：`docs/specs/2026-10-12-crm-order-record-design-v0.md`（A 级，给已上线的表加列加记钱相关导入）。最小第一步 = 给 crm_bookings 加来源与发票号两列 + 按出发日汇总的只读销售进度页 + 3 月 9 单的导入工具。
接棒需求卡 `2026-10-12-crm-order-record-need-parked`；优先级按 §11 三维打分为 P0（PM 最新指示）。
待 PM 回答的问题：销售进度页第一步要不要显示金额（建议只显示已收定金/尾款几单）。
