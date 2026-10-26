---
id: 2026-10-12-todo-fold-root-cause-duplicates
title: 今日待办里同一个根因报了很多次的，折成一次，邮件不再重复让 PM 看
status: decided
owner: agent
decided_on: 2026-10-12
source: pr:2489
verify_by: 2026-10-15
verify_how: 看合并后发出的今日待办邮件，AI 可见度体检全挂了那几条不再出现在要你点一次的栏里（改在开发欠账计数里），同一客户的授权断了和私信同步失败只剩一条。
---
PM 要求邮件只发机器完成不了的事。AI 账户余额用完时，各客户体检全挂只是症状，已改归开发栏；同一客户授权断了和同步失败是同一个修法，只留一条。
