---
id: 2026-10-18-prod-migration-applied-but-file-only-on-closed-pr
title: 生产库里已经应用了一份熔断策略迁移（两个能写授权策略的数据库函数），但它的文件和调用代码只在已关闭的 PR 2019 分支上——生产和主干不一致
status: decided
owner: agent
decided_on: 2026-10-18
source: session:c668eb35
verify_by: 2026-11-03
verify_how: 三选一并留结论：①把 ads_circuit_breaker_policy（9-28 那份） 迁移文件摘回主干（让 git 能还原生产）并写明这两个函数现在无人调用 ②确认无人用后用一份新迁移 DROP 掉两个函数 ③PM 决定保留。同时 supabase_migrations 里还有一条更早的 ads_circuit_events（v1），主干只有 v2 的文件，一并对齐。动生产库的 DROP 需要 PM 单独点头
---
2026-10-18 对生产库只读实查：supabase_migrations 里有 ads_circuit_events、ads_circuit_events_v2 与 ads_circuit_breaker_policy（9-28 那份） 三条；public 下有 ads_trip_circuit_breaker_policy_batch 与 ads_release_circuit_breaker_policy 两个 SECURITY DEFINER 函数（执行权限原卡记为只有 service_role，本次未重核）。
主干迁移目录里只有 ads_circuit_events_v2 的文件；policy 那份只在已关闭的 PR 2019 分支上，调用它的代码（ads-circuit-breaker-check 等）主干根本没有。
合并了 PR 2019 的两张原卡：untracked-migration（表与迁移记录对不上）和 runtime-caller（迁移已应用、Inngest 从未同步）。
危险度：函数能改授权策略但无人调用，权限收窄，所以不是紧急；问题是「读 git 还原不出生产现状」，且哪天有人重开 2019 或另写调用方会误用它们。按 §11：频率 低 · IMPACT 中 · 收入 低 → P3。
