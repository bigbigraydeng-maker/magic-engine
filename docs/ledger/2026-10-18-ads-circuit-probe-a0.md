---
id: 2026-10-18-ads-circuit-probe-a0
title: A0 只读熔断探针已写（零写入路径、由扫源码的测试钉住），它的产出就是 PM 等的那份「防烧钱刹车真实数据」
status: decided
owner: agent
decided_on: 2026-10-18
source: session:c668eb35
verify_by: 2026-10-29
verify_how: 接线后跑 7-10 天，看 cron_run_logs 里每天的探针回执能不能回答三件：①五条判据各判出什么、判不了占多少 ②绝对硬顶在 1/3/5/6 倍下各会 trip 几天 ③哪些账户因未配上限或休眠压根判不了。拿到这三样才谈接写入、硬顶定几倍、dry_run 能不能关
---
PM 10-18 批「先走只读版」。模块 src/lib/ads-strategy/circuit-probe.ts + 测试已写、10/10 绿；三条变异都红对了（偷加写入→红2、候选倍数收成一个值→红2、跳过客户记成没超→红1）。
零写入由扫源码的测试机械钉住，不靠注释承诺——这是它比「默认关的开关」强的地方；也不替任何阈值挑数（1/3/5/6 倍各会判什么都如实记）。
二审点名的都焊进去了：账户时区目标日、truncated 当判不了、NULL 上限单列一类、判据#5 两种判不了分开、跳过≠没超。
追记（74 号实证）：CTS 官方账户是主动停投不是采数断了；由此查实共享层 circuit-cap-facts.ts:147,181 把「在不在投」判错一层（一个系列 ACTIVE 就算在投），判据 #2 对 CTS 因此永远判不了。A0 只分层记录暴露它，不改共享层。
还差接线（回执落 cron_run_logs.summary，不建新表）；观察窗口以 10/22 为分界。细节见 docs/specs/2026-10-18-wp32-hanxin-implementation-plan-v0.2.md 的 A0 节。
