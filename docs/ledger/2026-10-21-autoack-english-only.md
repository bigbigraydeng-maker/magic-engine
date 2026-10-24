---
id: 2026-10-21-autoack-english-only
title: 自动安抚消息只发英文一句，不再带中文（PM 要求：自动回复不可以出现中文）
status: decided
owner: pm
decided_on: 2026-10-21
source: session:96dc6edf
verify_by: 2026-10-28
verify_how: 合并部署后，用 CTS 的 WhatsApp 测试号发一条消息，收到的自动安抚只有一句英文（Thanks for your message…），没有中文那一行；员工回复指标里，历史上发出的双语安抚仍被算成「ME 自动安抚」，不算顾问回复
---
PM 原话（2026-10-21）：自动回复不可以出现中文，并贴出了当前双语的两行文案。改动只有 autoack-identity.ts 里那一句固定文案；旧的双语版本保留为只用于「识别历史消息」的常量，所以回复指标对老消息的判断不变。
不动发送逻辑、不动限频和 AI 起草。中文客人由顾问用中文接。风险级别 B（一句固定文案，可随时改回）。
