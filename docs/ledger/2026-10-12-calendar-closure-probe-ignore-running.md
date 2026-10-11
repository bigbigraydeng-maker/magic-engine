---
id: 2026-10-12-calendar-closure-probe-ignore-running
title: 日历巡检核对自己时误把自己这一轮正在进行的记录当成失败，已修
status: decided
owner: agent
decided_on: 2026-10-12
source: pr:2367
verify_by: 2026-10-14
verify_how: 看 10 月 13 日起巡检回执里「查一下日历到期事项巡检上线后第一次自己跑成没成」这条的核对结果是通过或还验不了，不再是没达预期。
---
线上第一次真跑发现：核对任务运行记录时，会看到自己正在跑的那一行，被算成没有成功。现在正在进行中的记录不参与判断。
