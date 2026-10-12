---
id: 2026-10-13-crm-order-record-design-v12
title: CRM 订单设计稿 v1.2 复用已上线的订单与付款进度，只补来源发票号两列和座位销售进度只读页；PM 本人说不要金额，金额整块已撤；待 PM 批准
status: decided
owner: pm
decided_on: 2026-10-13
source: session:f53ba28d
verify_by: 2026-10-19
verify_how: 看设计稿是否已过第二轮复审并由 PM 批准或否决；批准则另开实施窗口，否决则把需求卡 2026-10-12-crm-order-record-need-parked 的日期往后挪并写原因
---
设计稿：`docs/specs/2026-10-12-crm-order-record-design-v0.md`（A 级，给已上线的表加列加写订单的导入）。最小第一步 = 给 crm_bookings 加来源与发票号两列 + 按出发日看座位上限已订剩余的只读页 + 3 月 9 单导入工具。
接棒需求卡 `2026-10-12-crm-order-record-need-parked`；优先级按 §11 三维打分为 P0（PM 最新指示）。
PM 已答：不要金额（2026-10-13 原话）；座位上限 3/11 3/18 3/26 是 20、上海周边团按官方 18 算；进度页只给名单里 2 个邮箱。待 PM：批准设计稿。
