---
id: 2026-09-27-rls-lock-policies-repo-fix-not-needed
title: 仓库里 70+ 条 RLS 策略漏 TO service_role — 核实结论「不用再加纠正迁移」
status: decided
owner: pm
decided_on: 2026-09-27
source: session:0d044cab
verify_by: 2026-10-04
verify_how: 跑 `bash scripts/db-replay-and-verify.sh`（起干净 postgres 重放全部 migration）应通过——这一步会跑 `scripts/db-invariants.sql`，其不变量 1/2 直接断言重放后 `pg_policies` 里不存在 `roles={public}` 或 `roles={authenticated}` 的无条件放行策略，`client_projects` / `ad_strategy_configs` 是否仍缺 `TO service_role` 以这个末态断言为准。**不要**用 `node scripts/check-policy-to-clause.mjs --all` 判断这两张表是否已修复：该命令按每个历史文件独立扫描 `CREATE POLICY`，不会结合同一张表后续的 `ALTER/DROP POLICY` 合并判断末态，`client_projects`（20260803140000）和 `ad_strategy_configs`（20260722000001）各自的建表迁移仍会各计 1 条漏 `TO`；且该命令只打印数量最多的 10 个文件，这两张表各只 1 条不会出现在打印列表里，容易被误读成「未出现 = 已验证通过」。CI 里对应检查名是 `.github/workflows/db-security-invariants.yml` 的「DB security invariants」job，PR 里应为绿。
---

原假设：生产是被人手工修好的，重建新环境会重造敞开策略，得加一条纠正迁移。
核实后不成立，但过程比最初想的绕：迁移 `..._rls_lock_policies_to_service_role.sql`
（2026-08-03 02:00）是一段扫描式自动收紧，重放到那一刻批量把坏策略锁到 service_role
（该文件注释里写明：2026-08-03 生产快照 118 条，全新空库重放是 102 条——两个数字都只是
那一刻的对账参考，不是断言）。

**那次扫描之后不是零个再犯**：迁移 `..._client_projects.sql`（同一天 14:00，晚于扫描）
新建了一条缺 `TO service_role` 的策略，直到 `..._fix_client_projects_rls_service_role.sql`
（2026-08-19）才单独修复；`ad_strategy_configs` 建表迁移同样漏了 TO 子句，直到
`..._fix_ad_strategy_configs_rls.sql`（2026-09-25）才修复。`.github/workflows/db-security-invariants.yml`
的说明里也直接写着仓库里仍有大量 `CREATE POLICY ... USING (true)` 缺 TO 子句的存量。

真正的兜底不是「后续零违规」这个（不成立的）track record，而是 #1969 / #1326 加的
CI 末态不变量：`scripts/db-replay-and-verify.sh` 把全部 migration 从零重放一遍并断言末态属性，
`scripts/check-policy-to-clause.mjs` 对新改动的文件强制要求写 `TO`、对存量只报告不拦截。
末态重放目前是干净的（`client_projects` / `ad_strategy_configs` 的漏洞都已被各自的修复迁移
在重放顺序里纠正），但这是靠「重放末态不变量」验证得到的结论，不是靠「这段时间没人再犯错」。
加一条新的冗余纠正迁移仍然无收益（末态已经对，不变量已经在管）— 等 PM 拍是否照原计划继续。
