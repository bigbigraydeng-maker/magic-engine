---
id: 2026-10-21-autoack-cooldown-f2-wait-fix
title: 安抚限频的硬伤修复：F1 因限频跳过时不会发「安抚已送达」事件，AI 起草会白等 5 分钟；起草前用同一个判断，F1 会跳过就不等
status: decided
owner: agent
decided_on: 2026-10-21
source: pr:2972
verify_by: 2026-10-28
verify_how: |-
  合并部署后，用测试号 6 小时内连发两条，读库：同一会话里第二条客人消息的 sent_at 到它对应的 AI 草稿 created_at（表 conversation_reply_drafts）之间应小于 90 秒（改前会等满 5 分钟）；SQL 示例：用 conversation_messages 的 sent_at 与 conversation_reply_drafts 的 created_at 按会话号和时间先后配对相减
---
来自 PR 2972 合并后的独立复核（子牙）：限频命中时自动安抚直接返回、不发事件，而 AI 起草最长等这个事件 5 分钟。修法：起草前用同一个 hasRecentOutbound 和同一个常量判断 F1 会不会跳过，会跳过就不等；读失败退回原来的照常等，不拦起草。顺带：读到不认识的空响应时抛错、测试钉住常量就是 6 并用字面量测边界。风险级别 A，范围放开到起草函数这一点由统筹同意。
