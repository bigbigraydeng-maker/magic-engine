---
id: 2026-10-26-revoke-ad-link-hardening-function-execute
title: 10-21 加的 14 个 SECURITY DEFINER 函数回收 PUBLIC/anon/authenticated 的 EXECUTE
status: decided
owner: agent
decided_on: 2026-10-26
source: session:9c08a71c
verify_by: 2026-11-02
verify_how: 迁移应用后在生产 DB 跑 `scripts/db-invariants.sql` 第 4 条——无 SECURITY DEFINER 函数对 anon/authenticated/PUBLIC 可执行；同时合主干后 CI 的 "DB security invariants" 回绿。
---
10-21 的 ad_creative_link_hardening 迁移文件 建了 14 个 SECURITY DEFINER 函数但没写 REVOKE，CI 不变量 4 从 10-25 起连红、阻塞所有 A 级 PR 合并（本窗口在合 feat/cron-partial-abandoned-token-hold 时撞到）。
修法：新 migration 对每个函数 `REVOKE EXECUTE FROM PUBLIC, anon, authenticated` + `GRANT EXECUTE TO service_role`，函数本体不动。签名按原 migration 的 pg_get_function_identity_arguments 完整写出，`REVOKE ... FROM PUBLIC` 单独不够（Supabase 用 ALTER DEFAULT PRIVILEGES 给 anon/authenticated 单独授了权）。迁移文件只进仓库，由 PM 决定何时 apply。
