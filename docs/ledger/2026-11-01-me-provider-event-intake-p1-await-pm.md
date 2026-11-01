---
id: 2026-11-01-me-provider-event-intake-p1-await-pm
title: 发信底座第一步做好了、等你放行：回「go apply」建表，亲手合并改动单，再让 Resend 把送达回执发给 ME
status: decided
owner: pm
decided_on: 2026-11-01
source: session:33ebcd0b
verify_by: 2026-11-08
verify_how: 看是否已：①回「go apply」且生产库有表 provider_webhook_events；②改动单已合并；③Resend 后台已为系统邮件账号建回调并只勾 7 个事件；④Render 已填 RESEND_WEBHOOK_SECRET_SYSTEM 并手动部署、部署时间晚于改变量。缺哪件就如实写缺哪件
---
每一步谁做、怎么做：docs/specs/2026-11-01-me-provider-event-intake-p1-design-v0.md §6（密钥只能 PM 本人填，不进聊天）。
这一步不发任何信、不改任何联系人，只是让 ME 开始收到并存下 Resend 的送达回执；碰迁移，合并要 PM 亲手。
派活记录（PM 11-01 分层规则）：方案 = Sonnet 5.5；方案审与实现审 = Opus 子代理（子牙、魏征）；代码 = DeepSeek（aider）。
