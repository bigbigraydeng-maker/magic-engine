---
title: "fix: manual-items.ts 合并后缺两个关闭括号"
status: done
risk: C
done_ref: "pr:2020"
verify_how: "type-check 通过 + 今日待办邮件正常发出"
verify_by: 2026-09-26
---

#2017 合并入 main 时冲突解决漏掉了 `pushMaliangRenderItems` 和 `pushLibaiItems`
的 `.catch()` 关闭括号，导致 TypeScript 编译报错，今日待办邮件管道全挂。
本修复只加 4 行纯语法修复。
