---
id: 2026-10-15-crm-multichannel-hot-lead-design
title: CRM 多渠道「热客」判断设计稿（建在 10-10 标准与事实表之上；分三步，第一步只显示不改名单）
status: decided
owner: agent
decided_on: 2026-10-15
source: session:ac16fd7f
verify_by: 2026-10-22
verify_how: 子牙 + 魏征两审意见并入后交 PM；PM 回「合」才开实现 PR。查三件事：① docs/specs/2026-10-15-crm-multichannel-hot-lead-design.md 在 main 上；② src/lib/crm/facts/io.ts 的渠道白名单是否已含 email（没含＝第一步没做）；③ 生产库 conversations 里 channel='email' 的段有没有 conversation_facts 行
---
2026-10-15 查生产库定下三件事：① 邮件就在 conversations 里（CTS 514 段 / NAL 52 段，都有逐条消息），旧稿「邮件不在 conversations」是过时的，接邮件不用新建任何东西；② 跨渠道只能当加分项——真跨渠道来过的 CTS 只 5.4%、NAL 为 0，且 NAL 64% 客人没电话没邮箱并不起来；③ 电话现在当不了信号（全库 9 通、4 份分析）。
顺带查出两个 bug：CTS 15 段 WhatsApp 对话消息计数全是 0，按 message_count>0 挑候选的任务整段跳过（所以 CTS WhatsApp 零摘要）；邮件进站 1678 条其实是群发打开/点击行为行，算来回必须先滤掉。
