---
id: 2026-09-26-pm-todo-five-kinds
title: 今日待办（邮件和后台页面）只给 PM 留五类事：拍板、点一次、转给客户、发前看一眼、认真假
status: done
owner: pm
decided_on: 2026-09-26
source: session:dba1f247
verify_by: 2026-09-29
verify_how: 上线后第一个工作日早上的今日待办邮件：①只有五类栏目，没有「SEO 巡逻 / 系统欠账 / 本周新建议卡 / 系统替你做了什么」栏；②标题件数跟后台今日待办页一致；③推销信和 ME 自测信不再一封一条（合成一行「陌生地址来信」或不出现）；④底部那行小字点进去，后台自动任务健康页的「开发欠账」栏能打开。四项全对算成
done_on: 2026-09-26
done_ref: pr:2065
last_checked: 2026-11-01
check_note: 11-01：gh pr view 2065 仍 MERGED(2026-09-27T11:55Z)；四项都要看当天待办邮件和登录后台，夜巡无邮箱和登录权限，判不了
---
PM 2026-09-26 拍板（记忆 project-pm-todo-only-five-kinds-2026-09-26）：9-25 那封 166 件，真要 PM 管的约 10 件。
按 9-25 组成重建的夹具：旧口径 166 → 新口径 25 件，全部落在五类里（src/lib/pm-todo/__tests__/fixtures/todo-2026-09-25.ts）。
开发欠账挪到后台自动任务健康页，知会挪到周一周报。过期成交回传的源头清理归另一张卡（2026-09-26-conversion-expired-sweep-regardless-of-toggle）。
