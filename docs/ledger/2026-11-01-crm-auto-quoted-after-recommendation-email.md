---
id: 2026-11-01-crm-auto-quoted-after-recommendation-email
title: CRM：同事发出点名出发日的推荐邮件后，已联系自动改已报价（每小时，先只用规则）
status: done
owner: agent
decided_on: 2026-11-01
done_on: 2026-11-01
done_ref: pr:3488
source: session:96dc6edf
verify_by: 2026-11-03
verify_how: 合并部署后第二天，查 CTS 里「已联系」且同事发过「推荐+出发日」主题邮件的人是否已变「已报价」：contact_stage_events 里 changed_by='system:quote-email-sent' 应有记录（首轮约 14 位较早客人），note 里带邮件主题；抽 3 位核对确实是我们发出的推荐行程。不成时第一步：看最近一次 messenger-hourly 回执里的 quoteAdvance（candidates/advanced/failed）。
---
PM 2026-11-01 回「做自动」：当天人工把 29 位「已联系」补改为「已报价」之后，要让以后每封这样的邮件自动处理。
规则：阶段是已联系 + 人发的一对一外发邮件主题同时有 recommendation/suggestion 和出发日（转发、群发、自动回执不算）；人在邮件之后手动定过阶段就不碰；只往前推。
没做：AI 读正文（主题没写出发日的推荐邮件、Re: Tour enquiry 回信仍归同事）；电话/WhatsApp 报价。
