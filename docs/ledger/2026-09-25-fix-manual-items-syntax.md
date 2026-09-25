---
id: 2026-09-25-fix-manual-items-syntax
title: "fix: manual-items.ts 合并后缺两个关闭括号"
status: done
risk: C
owner: agent
decided_on: 2026-09-25
source: session:121634d6
done_on: 2026-09-25
done_ref: "pr:2017"
verify_how: "type-check 通过 + 今日待办邮件正常发出"
verify_by: 2026-09-26
---

#2017 合并入 main 时冲突解决漏掉了 `pushMaliangRenderItems` 和 `pushLibaiItems`
的 `.catch()` 关闭括号，导致 TypeScript 编译报错，今日待办邮件管道全挂。
本修复只加 4 行纯语法修复。
