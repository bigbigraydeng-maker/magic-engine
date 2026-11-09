---
id: 2026-09-26-cts-title-cycle-stays-on
title: CTS 网站「标题每周自动改」开关保持开着，等子牙审完修「范围改窄」的 PR #1948；周二核对周一那一轮改了什么
status: decided
owner: pm
decided_on: 2026-09-26
source: session:3b976bb5
verify_by: 2026-09-29
verify_how: 9/29 查三件事：①9/28 晚那一轮在 CTS 网站仓库合并了哪几条标题改动（最多 3 条，零条也正常）；②每条新标题没有把范围改窄或说错（出发城市、线路名、城市名）；③网站上已是新标题。三项都对算成；有改错的就在那条 PR 点 Revert 撤回
---
孔子窗口 2026-09-26 只读核实：生产里 CTS 的 seo_config.meta_cycle_enabled 是开着的，而 docs/DECISIONS.md 2026-09-20 与 docs/STATE.md 写的是「CTS 关着，等 PM 看过演练再开」；每周一 05:30 UTC 那一轮开 PR 后会立即自己合并上线。
PM 当天在孔子窗口回「不关，那边代码子牙在检查」：保持开着，修「范围改窄」的 PR #1948 由子牙审。
已加日历提醒 9/29 09:00。文档与生产不一致这一点，留给标题周循环的负责窗口在 DECISIONS / STATE 里改正。
