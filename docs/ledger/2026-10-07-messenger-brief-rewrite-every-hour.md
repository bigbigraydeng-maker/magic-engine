---
id: 2026-10-07-messenger-brief-rewrite-every-hour
title: 私信需求卡每小时把同一批对话整批重写，模型调用浪费约九成
status: decided
owner: agent
decided_on: 2026-10-07
source: session:d925e4da
verify_by: 2026-10-10
verify_how: 合并三天后看 conversation_briefs 的 regen_count 是否出现大于 1 的行、每小时 messenger-brief-hourly 的 generated 是否从恒 50 降到个位数到十几
---
根因：库返回一对一关系是对象，代码当数组取第一个，永远判成没写过卡。
修法：数组和对象两种形状都认。
