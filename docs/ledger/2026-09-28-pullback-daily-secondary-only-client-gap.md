---
id: 2026-09-28-pullback-daily-secondary-only-client-gap
title: 每日拉数任务的客户名单只认主账户——只登记了辅助账户的客户整个跳过（不拉数、不诊断、也不会被熔断探针观察）
status: decided
owner: agent
decided_on: 2026-09-28
source: session:c668eb35
verify_by: 2026-12-01
verify_how: 查是否有客户在 client_meta_ad_accounts 里有行、但 clients.meta_ad_account_id 为空（2026-10-18 实查登记表 7 行 6 个客户，是否有这种客户待核）；有就升级处理。另注意：A0 探针与将来的韩信都挂在这个任务里，所以这条会让它们一起漏掉那类客户
---
摘回自已关闭的 PR 2019 分支，2026-10-18 对主干重新核：google-data-pullback-daily/route.ts 文件头仍明写这条「已知范围边界」——客户名单仍以 clients.meta_ad_account_id 为键，只登记辅助账户的客户不进循环。主干另有 getActiveClientsWithMetaAccounts（读两处合并名单），但这个任务没用它。
原卡当时的结论是「今天的真实数据不触发」，这点本次没有重新核，标待核。
按 §11：频率 低 · IMPACT 中（丢分析与探针观察，不丢安全闸——每日安全清扫那条路两处都查）· 收入 中 → P2。
