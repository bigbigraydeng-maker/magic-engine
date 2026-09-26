---
id: 2026-09-25-fix-manual-items-syntax
title: "fix: manual-items.ts 合并后缺两个关闭括号"
status: done
risk: C
owner: agent
decided_on: 2026-09-25
source: session:121634d6
done_on: 2026-09-25
done_ref: pr:2020
verify_how: "type-check 通过 + 今日待办邮件正常发出"
verify_by: 2026-09-26
last_checked: 2026-09-27
check_note: 判不了：修复 9-25 12:27 UTC 合并后今日待办邮件还没跑过一次（最近一次 9-24 19:01 UTC，在修复之前）；type-check 本次未跑（主干基线已知红，单跑不能证明这条）
---

#2016（李白）合并入 main 时冲突解决漏掉了 `pushMaliangRenderItems` 和 `pushLibaiItems`
的 `.catch()` 关闭括号（合并提交 76218533 起），导致 TypeScript 编译报错，
Render 部署失败，今日待办邮件管道全挂。#2017 合并后问题延续。
本修复只加 4 行纯语法修复。
