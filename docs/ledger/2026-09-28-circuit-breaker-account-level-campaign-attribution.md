---
id: 2026-09-28-circuit-breaker-account-level-campaign-attribution
title: 熔断的花费汇总按「客户+账户+系列级」直接相加，没做「这个系列属于谁」的过滤——CTS 账户里混着别的客户的历史系列，休眠时无害，一旦重新花钱就会算错
status: decided
owner: agent
decided_on: 2026-09-28
source: session:c668eb35
verify_by: 2026-11-03
verify_how: 先查 ad_daily_insights 建表迁移的表注释点名的那几条历史系列近 7 天有没有花费（有就立即按 §11 重新打分）；再看写入侧（pullback 同步）有没有可用的系列归属信号，没有就要先决定归属事实建在哪（新表 / 例外名单 / 人工审核），这是独立设计，需过子牙魏征
---
摘回自已关闭的 PR 2019 分支。原卡讲的是 2019 自己的 circuit-breaker-spend.ts（主干没有），2026-10-18 对主干重新核：同样的读法在主干的 circuit-spend-window.ts 里（按客户、账户、level=campaign 过滤后直接相加，没有系列归属校验），且 ad_daily_insights 建表注释自己写着「账户级汇总必须从过滤后的系列行聚合，不能信账户总数」。
这是全平台对这张表的既有读取惯例，不是熔断独有的疏漏，所以要修得先搞清楚系列归属从哪来。
按 §11：频率 低（历史系列近 7 天零花费）· IMPACT 高 · 收入 高 → 恰好一个低 → P1。现在 A0 探针与将来的熔断写入都吃这个汇总，写 trip 之前必须先过这一关。
