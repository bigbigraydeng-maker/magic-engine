# 仓库 RLS 策略漏 TO service_role：是否需要纠正迁移（核实记录）

对应台账卡 docs/ledger/2026-09-27-rls-lock-policies-repo-fix-not-needed.md。

## 结论
不需要再加一条纠正迁移：全新环境从零重放后，末态已无无条件放行策略，不变量已在管。

## 时间线（已按审查意见更正）
- 迁移 `..._rls_lock_policies_to_service_role.sql`（2026-08-03 02:00）是扫描式自动收紧，重放到那一刻批量把坏策略锁到 service_role。文件注释写明：2026-08-03 生产快照 118 条、全新空库重放 102 条，两个数字只是当时对账参考，不是断言。
- 扫描之后新建且漏 TO 的：`..._client_projects.sql`（同日 14:00，晚于扫描），直到 `..._fix_client_projects_rls_service_role.sql`（2026-08-19）单独修复。
- `ad_strategy_configs` **不是**扫描之后的再犯：它的建表迁移（2026-07-22）早于扫描，其漏 TO 的策略已被扫描收紧；2026-09-25 的 fix 迁移只是再次显式重建已收紧的策略。
- `.github/workflows/db-security-invariants.yml` 的说明也写着仓库里仍有大量 `CREATE POLICY ... USING (true)` 缺 TO 子句的存量；`scripts/check-policy-to-clause.mjs` 对新改动文件强制要求写 TO，对存量只报告不拦截。

## 兜底机制
`scripts/db-replay-and-verify.sh` 从零重放全部 migration 并断言 `scripts/db-invariants.sql` 的末态不变量。注意：只改文档的 PR 不会触发 `db-security-invariants.yml`（其触发路径只含 migration、两个数据库脚本和工作流本身），所以重放证据必须手动实跑或取主干 / workflow_dispatch 运行记录。

## 重放记录
- 2026-09-27：本地起干净 postgres（库名 me_ci_verify），重放当时仓库内 288 个 migration 全部成功，四条不变量通过（当时的快照）。
- 2026-10-10 05:08 UTC：在提交 2d8910d380eeda3977db2dab9784cc83ff77a999 上，`DB=me_ci_verify_67 bash scripts/db-replay-and-verify.sh`，退出码 0，输出「通过 297 / 失败 0」，不变量 1 至 4 全部通过。此次重放的是该提交下的 297 个 migration，不覆盖之后才合进主干的迁移。
- 不要用 `node scripts/check-policy-to-clause.mjs --all` 判断这两张表是否已修好：它按单个历史文件扫描 CREATE POLICY，不结合后续 ALTER/DROP，两张表的建表迁移仍会各计 1 条，且只打印数量最多的 10 个文件。
