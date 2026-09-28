---
id: 2026-09-25-fix-manual-items-syntax
title: "fix: manual-items.ts 合并后缺两个关闭括号"
status: verified
risk: C
owner: agent
decided_on: 2026-09-25
source: session:121634d6
done_on: 2026-09-25
done_ref: pr:2020
verify_how: "type-check 通过 + 今日待办邮件正常发出"
verify_by: 2026-09-26
last_checked: 2026-09-28
check_note: 今日待办邮件管道9-27恢复正常(9-25/9-26两天零记录)，该文件已无语法解析错误
verified_ref: doc:docs/ledger/evidence/2026-09-25-fix-manual-items-syntax--2026-09-28.md
---

#2016（李白）合并入 main 时冲突解决漏掉了 `pushMaliangRenderItems` 和 `pushLibaiItems`
的 `.catch()` 关闭括号（合并提交 76218533 起），导致 TypeScript 编译报错，
Render 部署失败，今日待办邮件管道全挂。#2017 合并后问题延续。
本修复只加 4 行纯语法修复。
