---
id: 2026-09-25-crm-c1b1y-due-todo
title: CRM 升级 C1b-1y-due：contact.important_due_at 到期自动进今日待办
status: done
owner: pm
decided_on: 2026-09-25
source: session:beef24ba
verify_by: 2026-10-06
verify_how: 合并后一位 CTS 联系人被写 important_note 且 due_at 设为今天或过去，次日待办邮件里出现「⭐重要标记到期」条目；员工清 due_at 后次日不再出现
done_on: 2026-09-25
done_ref: pr:2007
last_checked: 2026-10-11
check_note: 夜巡盖章：done_ref 指向的 PR 已合并（或为文档/提交型指向），但 verify_how 要求的实证本晚未取到，不翻状态
---
方案 pr:2000 §7 C1 板桥硬伤 2 完整收官（星标 + 原因 + 到期日 + 到期入待办）。DeepSeek 一轮 $0.01；3 文件；tsc 0 新增、55 pm-todo 测试全过。
