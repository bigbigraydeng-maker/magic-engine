---
id: 2026-11-10-crm-ai-follow-up-letter-draft-button
title: CRM 写邮件框加「让 AI 写跟进信」按钮：只出草稿、员工自己发，带团页链接、官网总链接和当场检查
status: decided
owner: agent
decided_on: 2026-11-10
source: session:3bed89ca
verify_by: 2026-11-24
verify_how: 合并上线、客户配置写好后，在 CTS 后台对样卷那 6 位客人各点一次，草稿口气对、链接能打开、检查没有误报算成；任何一封编了日期价格或写了星级算不成
---
PM 11-10 看过跟进信考卷第二版回「口气对」、对下一刀回「开始」。写信逻辑在 `src/lib/crm/email-compose/follow-up-draft.ts`，团的日期价格和团页链接只取团目录，问候/署名/官网总链接/价格口径是客户配置（`clients.leads_config.follow_up_writer`，写这份配置要 PM 点头）。
不发信、不改发信规矩、不加库表。自动跟进（刀 C 后半、刀 D）以后复用同一个写信函数。
