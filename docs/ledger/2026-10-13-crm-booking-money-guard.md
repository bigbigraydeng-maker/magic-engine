---
id: 2026-10-13-crm-booking-money-guard
title: 付款进度读取路径守卫：列表/抽屉/付款总览永远不读金额列；设计稿审计表条款改写（为 60 号的订单金额方案让路）
status: done
owner: agent
decided_on: 2026-10-13
done_on: 2026-10-13
done_ref: pr:2528
source: session:1a85e0eb
verify_by: 2026-10-27
verify_how: 60 号的订单金额迁移合并后，src/lib/crm/__tests__/booking-no-money-columns.test.ts 仍通过；付款总览页与抽屉接口响应里没有金额
---
统筹转述 PM（2026-10-13）：销售进度页要显示金额，由 60 号窗口做（PR 2493）。我这边只做两件：设计稿 v0.2 §7.3 审计条款由「不含金额」改为含金额、发票号只存布尔；加源码级守卫测试，防止付款进度的读取代码被改成透传整行。不改任何数据库，不改界面。
