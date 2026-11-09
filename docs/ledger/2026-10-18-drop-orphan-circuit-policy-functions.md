---
id: 2026-10-18-drop-orphan-circuit-policy-functions
title: PM 说「删」——生产库里两个无人调用的熔断策略函数，迁移文件已写好，等 PM 另点头才应用
status: decided
owner: pm
decided_on: 2026-10-18
source: session:c668eb35
verify_by: 2026-10-25
verify_how: 应用迁移后查 information_schema.routines：ads_trip_circuit_breaker_policy_batch 与 ads_release_circuit_breaker_policy 两个函数都不再存在；ads_circuit_events_append_only 与 client_automation_policies 的触发器仍在。没应用就保持 decided，不要自己应用
---
PM 10-18 回「删」。我只写了迁移文件 supabase/migrations/ 目录下名为 drop_orphan_ads_circuit_breaker_policy_functions 的那份（10-18 日期），没应用生产库——动生产库的 DROP 要 PM 单独点一次头，A 级 PR 保持草稿等「合 N」。
核查（10-18 只读）：主干零引用；库内无别的函数/视图依赖；它们写过的策略行 0 条；只有 postgres 与 service_role 能执行。
迁移自带安全闸：若发现 updated_by 以 circuit-breaker: 开头的策略行，中止而不是静默继续（否则删掉 release 就没法解除）。
上一张关联卡：2026-10-18-prod-migration-applied-but-file-only-on-closed-pr（讲清为什么这两个函数会在生产里）。
