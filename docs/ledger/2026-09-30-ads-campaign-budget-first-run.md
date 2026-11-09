---
id: 2026-09-30-ads-campaign-budget-first-run
title: 预算下调 Inngest 首次安全试跑
status: decided
owner: pm
decided_on: 2026-09-30
source: pr:2204
verify_by: 2026-10-06
verify_how: 先由 PM 指定测试客户、广告系列和下调额度；核对 Inngest 函数注册，再经 PM 明确批准执行一次，确认 Meta 前后预算与 Kernel 回执一致；未指定或未批准前不发预算事件。
---

当前无法安全当场发起真实预算事件：该事件会写入 Meta 广告系列预算。必须等 PM 指定测试对象及额度并明确批准后再验。
