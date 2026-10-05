---
id: 2026-10-05-cts-precall-ai-chat-design
title: CTS 咨询客人「AI 先聊两句、为销售联系做准备」——设计稿已出，措辞与 6 项业务选择已拍板，还没开始写代码
status: decided
owner: pm
decided_on: 2026-10-05
source: session:ebab7fb4
verify_by: 2026-10-12
verify_how: 一周后看设计稿里的第一步（查清自动回复开关开着却从没发出过消息的原因）有没有人接手；没人接手就在今日待办里提醒 PM 派人
---
设计稿：docs/specs/2026-10-05-cts-precall-ai-chat-design-v0.1.md。已定：不开 Meta 原生 AI 客服；首条不自称 AI、不提打电话、只回英文、全天发；只问出行时间和人数。
关键发现：CTS 的自动回复近 60 天从未发出一条，原因最可能是客人消息靠每小时同步进来、同步不触发自动回复（待第一步查实）。
待办：Meta 确认语改成可点选的问题——已派给另一个窗口；设计稿第二轮复审未做。
