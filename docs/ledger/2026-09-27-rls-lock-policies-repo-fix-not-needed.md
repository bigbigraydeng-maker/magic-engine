---
id: 2026-09-27-rls-lock-policies-repo-fix-not-needed
title: 仓库里 70+ 条 RLS 策略漏 TO service_role — 核实结论「不用再加纠正迁移」
status: decided
owner: pm
decided_on: 2026-09-27
source: session:0d044cab
---

原假设：生产是被人手工修好的，重建新环境会重造敞开策略，得加一条纠正迁移。
核实后不成立：`supabase/migrations/20260803020000_rls_lock_policies_to_service_role.sql`
是一段扫描式自动收紧，重放到那一刻批量把 118 条坏策略锁到 service_role，
新环境重放会重跑一次，末态跟生产一样。20260803020000 之后 60+ 个新迁移里
零个再犯这个错。未来违规兜底靠 PR #1969 加的不变量 1（CI 断言末态）。
加冗余迁移无收益 — 等 PM 拍是否照原计划继续。
