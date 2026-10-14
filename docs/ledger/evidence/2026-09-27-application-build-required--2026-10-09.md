# 证据：2026-09-27-application-build-required · 取数 2026-10-09（NZ 时间，日历巡检只读核实）

日历事件：查一下「编译不过就合不进主干」这道闸有没有真的在拦

## 结论

main 规则里必过检查含 Application build（共 7 项必过）；9-28 之后新 PR 样本 8 个，有结果的 6 个 Application build 均 SUCCESS（#2384/2382/2381/2380/2379/2378）。

## 怎么查的

gh api repos/.../rules/branches/main => required_status_checks 含 context=Application build（integration_id 15368）；gh pr list 看 statusCheckRollup 中 Application build conclusion=SUCCESS。
