---
id: 2026-09-27-rls-lock-policies-repo-fix-not-needed
title: 仓库里 70+ 条 RLS 策略漏 TO service_role — 核实结论「不用再加纠正迁移」
status: done
owner: pm
decided_on: 2026-09-27
source: session:0d044cab
verify_by: 2026-10-04
verify_how: 重新实跑一次 `bash scripts/db-replay-and-verify.sh`（本地起干净 postgres 重放全部 migration，不依赖 CI 是否被触发）应通过——该脚本会跑 `scripts/db-invariants.sql`，其不变量 1/2 直接断言重放后 `pg_policies` 里不存在 `roles={public}` 或 `roles={authenticated}` 的无条件放行策略，`client_projects` / `ad_strategy_configs` 是否仍缺 `TO service_role` 以这次重放的末态断言为准。**不要**用 `node scripts/check-policy-to-clause.mjs --all` 判断这两张表是否已修复：该命令按每个历史文件独立扫描 `CREATE POLICY`，不会结合同一张表后续的 `ALTER/DROP POLICY` 合并判断末态，`client_projects`（对应 `..._client_projects.sql` 建表迁移）和 `ad_strategy_configs`（对应 `..._ad_strategy_configs.sql` 建表迁移）各自的建表迁移仍会各计 1 条漏 `TO`；且该命令只打印数量最多的 10 个文件，这两张表各只 1 条不会出现在打印列表里，容易被误读成「未出现 = 已验证通过」。**也不要**只看某条 PR 上「DB security invariants」检查是否为绿来下结论：`.github/workflows/db-security-invariants.yml` 的 `pull_request` 触发路径只匹配 `supabase/migrations/**`、`scripts/db-invariants.sql`、`scripts/db-replay-and-verify.sh`、workflow 自身四类改动，纯文档改动的 PR 根本不会触发这个 job，绿/无状态都不能当证据；要么本地实跑上面那条命令并留存输出，要么用 `workflow_dispatch` 手动触发一次并引用那次运行链接。
done_on: 2026-09-27
done_ref: pr:2100
last_checked: 2026-10-10
check_note: 2026-10-10 在提交 2d8910d38 上本地重放 297 个 migration 全部成功、四条安全不变量全部通过（证据见审计文档），verify_how 的重放判据成立；留给夜巡按 verified_ref 规则翻状态。
---
核实结论：不用再加纠正迁移。2026-08-03 的扫描迁移把当时存量坏策略锁到 service_role；之后个别新建迁移又漏过 TO，但已被单独修复，末态由 CI 的重放不变量兜底。
详细核实过程与时间线见 docs/audits/2026-09-27-rls-lock-policies-replay-check.md（含 2026-10-10 重放 297 个 migration 全部通过的记录）。
