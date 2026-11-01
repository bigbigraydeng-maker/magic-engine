---
id: 2026-11-01-me-provider-event-intake-p1-await-pm
title: 发信底座第一步做好了、等你放行：回「go apply」建表，亲手合并改动单，再让 Resend 把送达回执发给 ME
status: verified
owner: pm
decided_on: 2026-11-01
source: session:33ebcd0b
verify_by: 2026-11-08
verify_how: 看是否已：①回「go apply」且生产库有表 provider_webhook_events；②改动单已合并；③Resend 后台已为系统邮件账号建回调并只勾 7 个事件；④Render 已填 RESEND_WEBHOOK_SECRET_SYSTEM 并手动部署、部署时间晚于改变量。缺哪件就如实写缺哪件
done_on: 2026-11-02
done_ref: pr:3483
verified_ref: doc:docs/ledger/evidence/2026-11-01-me-provider-event-intake-p1-await-pm--2026-11-02.md
last_checked: 2026-11-02
check_note: 四件都已做到：表在、3483 已合、回调已建并启用（7 个事件）、密钥已部署生效；真实回执已入库
---
每一步谁做、怎么做：docs/specs/2026-11-01-me-provider-event-intake-p1-design-v0.md §6（密钥只能 PM 本人填，不进聊天）。
这一步不发任何信、不改任何联系人，只是让 ME 开始收到并存下 Resend 的送达回执；碰迁移，合并要 PM 亲手。
放行时请一并点头：我在 Resend 后台建回调（先停用）、之后启用、核验时点 Replay、向 hello@ 发内部测试信（设计稿 §6-3）。
派活记录（PM 11-01 分层规则）：方案 = Sonnet 5.5；方案审与实现审 = Opus 子代理（子牙、魏征）；代码 = DeepSeek（aider）。
