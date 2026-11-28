---
id: 2026-11-28-crm-ai-letter-tracking
title: AI 起草的客人信一封一行记下来（原稿、终稿、改没改、谁放行），记不上就不给稿子、不发信。PM 11-28 原话「ai 写的信一定要有标记，做跟踪和学习，分析」
status: decided
owner: agent
decided_on: 2026-11-28
source: session:96dc6edf
verify_by: 2026-12-03
verify_how: 12-03（周四）查线上库：①crm_ai_letters 表存在，开着行级保护、只有服务器能读写。②表里有 11-30 之后的行，surface 有客人抽屉或跟进信页的；凡是 request_id 不为空的行，在 crm_email_send_receipts 里都能按 request_id 找到发信回执。③反查：11-30 之后跟进信页、第 7 天跟进信页发出的信（回执里 actor 为员工、没有模板的），每封都能在 crm_ai_letters 里按 request_id 找到。算成：三条都对。没人用过 AI 起草（表是空的）不算失败，写「还没用过」。不成时第一步：看起草接口有没有返回 503 not_recorded。
---
起因：PM 要求 AI 写的信能被追踪、学习、分析。之前 AI 起草只返回文字，发出去后和员工自己写的信分不出来。
这一刀只做「记下来」：新表 crm_ai_letters；起草接口写完就记，记不上不给稿子；两条发送路在发信前把这次发送绑到 AI 稿子上，记不上不发。三个页面都带上标记。
不在这一刀：时间线上的「AI 起草」小标、AI 信效果页（回信率、改稿率、走到报价订团），表里有数后下一张改动单做。发没发成、客人回没回不存这张表，按 request_id 去回执和往来里查。
上线顺序：先建表、再合并；反过来会让所有 AI 起草被拒。改动单碰数据库结构，留给 PM 亲手合。设计稿 docs/specs/2026-11-28-crm-ai-letter-tracking-design-v0.md。
